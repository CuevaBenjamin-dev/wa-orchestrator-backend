import { Injectable, Logger } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { ConversationsService } from '../../conversations/conversations.service';
import { LeadsService } from '../../leads/leads.service';
import { UsageService } from '../../usage/usage.service';
import { WhatsappIncomingMediaMessage } from '../../whatsapp/whatsapp-media-message.types';
import { IpdeConversationTurnService } from '../conversation-engine/ipde-conversation-turn.service';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeOrderService } from '../services/ipde-order.service';
import { IpdeConversationStateService } from '../services/ipde-conversation-state.service';
import { IpdeOutboundActionExecutorService } from '../outbound/ipde-outbound-action-executor.service';
import { IpdeOutboundExecutionResult } from '../outbound/ipde-outbound-action-executor.types';
import { IpdePaymentProofDetectorService } from '../payment-proof/ipde-payment-proof-detector.service';
import { IpdePaymentProofService } from '../payment-proof/ipde-payment-proof.service';
import { IpdeWhatsappMessageMapperService } from './ipde-whatsapp-message-mapper.service';
import { IpdeWhatsappOutboundPersistenceService } from './ipde-whatsapp-outbound-persistence.service';
import {
  IpdeWhatsappHandleMessageInput,
  IpdeWhatsappMessageContext,
  IpdeWhatsappMessageResult,
  IpdeWhatsappTenant,
  IpdeWhatsappTextMessage,
} from './ipde-whatsapp.types';

@Injectable()
export class IpdeWhatsappOrchestratorService {
  private readonly logger = new Logger(IpdeWhatsappOrchestratorService.name);

  constructor(
    private readonly mapper: IpdeWhatsappMessageMapperService,
    private readonly leads: LeadsService,
    private readonly conversations: ConversationsService,
    private readonly usage: UsageService,
    private readonly turns: IpdeConversationTurnService,
    private readonly executor: IpdeOutboundActionExecutorService,
    private readonly outboundPersistence: IpdeWhatsappOutboundPersistenceService,
    private readonly paymentProofs: IpdePaymentProofService,
    private readonly paymentProofDetector: IpdePaymentProofDetectorService,
    private readonly states: IpdeConversationStateService,
    private readonly orders: IpdeOrderService,
  ) {}

  canHandleTenant(params: {
    tenant: unknown;
    phoneNumberId: unknown;
  }): boolean {
    return this.mapper.canHandleTenant(params);
  }

  async handleIncomingMessage(
    input: IpdeWhatsappHandleMessageInput,
  ): Promise<IpdeWhatsappMessageResult> {
    const tenant = this.mapper.toTenant(input.tenant);
    const phoneNumberId =
      typeof input.phoneNumberId === 'string' ? input.phoneNumberId.trim() : '';
    const externalId = this.mapper.getProviderMessageId(input.message);

    try {
      if (!tenant || !phoneNumberId) {
        return {
          status: 'ipde_processing_error',
          externalId: externalId ?? undefined,
          errorCode: 'INVALID_IPDE_WEBHOOK_CONTEXT',
        };
      }

      if (!externalId) {
        return {
          status: 'ignored_empty_message',
          tenantId: tenant.id,
          reason: 'MESSAGE_ID_MISSING',
        };
      }

      const duplicate = await this.conversations.findByExternalId(externalId);
      if (duplicate) {
        return { status: 'duplicated_message_ignored', externalId };
      }

      const type = this.mapper.getMessageType(input.message);
      if (type === 'text') {
        return await this.handleText({
          tenant,
          phoneNumberId,
          message: input.message,
          contacts: input.contacts,
        });
      }
      if (this.mapper.isSupportedMediaType(type)) {
        return await this.handleMedia({
          tenant,
          phoneNumberId,
          message: input.message,
          contacts: input.contacts,
        });
      }

      return {
        status: 'ipde_media_ignored',
        tenantId: tenant.id,
        reason: 'UNSUPPORTED_OR_INVALID_MEDIA',
      };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'ipde_whatsapp_processing_failed',
          tenantId: tenant?.id,
          externalId,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        }),
      );
      return {
        status: 'ipde_processing_error',
        tenantId: tenant?.id,
        externalId: externalId ?? undefined,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      };
    }
  }

  private async handleText(params: {
    tenant: IpdeWhatsappTenant;
    phoneNumberId: string;
    message: unknown;
    contacts: unknown;
  }): Promise<IpdeWhatsappMessageResult> {
    const mapped = this.mapper.mapTextMessage(params.message);
    if (!mapped) {
      return {
        status: 'ignored_empty_message',
        tenantId: params.tenant.id,
        reason: 'TEXT_EMPTY_OR_FROM_MISSING',
      };
    }

    const context = await this.prepareConversationContext(
      params.tenant,
      params.phoneNumberId,
      mapped,
      params.contacts,
      mapped.text,
    );
    const recentMessages = await this.recentMessagesExcluding(
      context.conversationId,
      context.inboundMessageId,
    );

    const turn = await this.turns.processTurn({
      tenantCode: IPDE_TENANT_CODE,
      tenantId: context.tenantId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      turnId: mapped.providerMessageId,
      userMessage: mapped.text,
      recentMessages,
    });
    await this.recordIpdeAiUsage(context.tenantId, turn.metadata);

    const outboundExecution = await this.executeAndPersistOutbound({
      context,
      actions: turn.outboundActions,
    });

    return {
      status: 'ipde_text_processed',
      tenantId: context.tenantId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      from: context.from,
      turn,
      outboundExecution,
    };
  }

  private async handleMedia(params: {
    tenant: IpdeWhatsappTenant;
    phoneNumberId: string;
    message: unknown;
    contacts: unknown;
  }): Promise<IpdeWhatsappMessageResult> {
    const media = this.mapper.mapMediaMessage(params.message);
    if (!media?.from) {
      return {
        status: 'ipde_media_ignored',
        tenantId: params.tenant.id,
        reason: 'UNSUPPORTED_OR_INVALID_MEDIA',
      };
    }

    const context = await this.prepareConversationContext(
      params.tenant,
      params.phoneNumberId,
      {
        providerMessageId: media.providerMessageId,
        from: media.from,
        text: this.mapper.safeInboundMediaContent(media),
      },
      params.contacts,
      this.mapper.safeInboundMediaContent(media),
    );
    const detection = await this.detectPaymentProof(context, media);

    if (!shouldRegisterPaymentProof(detection)) {
      return {
        status: 'ipde_media_ignored',
        tenantId: context.tenantId,
        leadId: context.leadId,
        conversationId: context.conversationId,
        from: context.from,
        reason: 'MEDIA_NOT_PAYMENT_PROOF',
        detection,
      };
    }

    const proof = await this.paymentProofs.registerPaymentProof({
      tenantCode: IPDE_TENANT_CODE,
      tenantId: context.tenantId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      provider: media.provider,
      providerMessageId: media.providerMessageId,
      providerMediaId: media.providerMediaId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
      fileName: media.fileName,
      caption: media.caption,
      sha256: media.sha256,
    });
    const outboundExecution = await this.executeAndPersistOutbound({
      context,
      actions: proof.outboundActions,
    });

    return {
      status: 'ipde_payment_proof_processed',
      tenantId: context.tenantId,
      leadId: context.leadId,
      conversationId: context.conversationId,
      from: context.from,
      detection,
      outboundExecution,
    };
  }

  private async prepareConversationContext(
    tenant: IpdeWhatsappTenant,
    phoneNumberId: string,
    message: IpdeWhatsappTextMessage,
    contacts: unknown,
    content: string,
  ): Promise<IpdeWhatsappMessageContext & { inboundMessageId: string }> {
    const contactName = this.mapper.contactNameFor(contacts, message.from);
    const lead = await this.leads.findOrCreateLead({
      tenantId: tenant.id,
      phone: message.from,
      name: contactName,
    });
    const conversation = await this.conversations.findOrCreateConversation({
      tenantId: tenant.id,
      leadId: lead.id,
    });
    const inbound = await this.conversations.addMessage({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content,
      externalId: message.providerMessageId,
    });
    await this.usage.incrementInboundMessage(tenant.id);

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      phoneNumberId,
      from: message.from,
      providerMessageId: message.providerMessageId,
      contactName,
      leadId: lead.id,
      conversationId: conversation.id,
      inboundMessageId: inbound.id,
    };
  }

  private async recentMessagesExcluding(
    conversationId: string,
    excludedMessageId: string,
  ): Promise<Array<{ role: 'USER' | 'ASSISTANT'; content: string }>> {
    const recent = await this.conversations.getRecentMessages(
      conversationId,
      7,
    );
    return recent
      .filter((message) => message.id !== excludedMessageId)
      .filter(
        (message) =>
          message.role === MessageRole.USER ||
          message.role === MessageRole.ASSISTANT,
      )
      .slice(-6)
      .map((message) => ({
        role: message.role as 'USER' | 'ASSISTANT',
        content: message.content,
      }));
  }

  private async detectPaymentProof(
    context: IpdeWhatsappMessageContext,
    media: WhatsappIncomingMediaMessage,
  ) {
    const state = await this.states.getState({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
    });
    const order = await this.orders.getActiveOrder({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
    });

    return this.paymentProofDetector.detect({
      mediaType: media.mediaType,
      caption: media.caption,
      fileName: media.fileName,
      mimeType: media.mimeType,
      currentStage: state?.stage,
      orderPaymentStatus: order?.paymentStatus,
      hasPaymentContext: false,
      hasQuotedPrice: Boolean(order?.quotedAmount),
    });
  }

  private async executeAndPersistOutbound(params: {
    context: IpdeWhatsappMessageContext;
    actions: IpdeOutboundAction[];
  }): Promise<IpdeOutboundExecutionResult | null> {
    if (!params.actions.some(shouldExecuteAction)) {
      return null;
    }

    const execution = await this.executor.execute({
      tenantCode: IPDE_TENANT_CODE,
      tenantId: params.context.tenantId,
      phoneNumberId: params.context.phoneNumberId,
      to: params.context.from,
      actions: params.actions,
    });
    await this.outboundPersistence.persistExecutedMessages({
      conversationId: params.context.conversationId,
      actions: params.actions,
      execution,
    });
    return execution;
  }

  private async recordIpdeAiUsage(
    tenantId: string,
    metadata: {
      openAiCalls: number;
      tokensInput: number;
      tokensOutput: number;
    },
  ): Promise<void> {
    if (
      metadata.openAiCalls <= 0 &&
      metadata.tokensInput <= 0 &&
      metadata.tokensOutput <= 0
    ) {
      return;
    }

    await this.usage.incrementAiUsage({
      tenantId,
      tokensInput: metadata.tokensInput,
      tokensOutput: metadata.tokensOutput,
    });
  }
}

function shouldExecuteAction(action: IpdeOutboundAction): boolean {
  return (
    action.type !== 'NO_AUTOMATED_RESPONSE' &&
    action.type !== 'DEFERRED_COMMERCIAL_REQUEST'
  );
}

function shouldRegisterPaymentProof(detection: {
  kind: string;
  confidence: string;
}): boolean {
  return (
    detection.kind === 'CONFIRMED_PAYMENT_PROOF' ||
    detection.confidence === 'HIGH' ||
    detection.confidence === 'MEDIUM'
  );
}
