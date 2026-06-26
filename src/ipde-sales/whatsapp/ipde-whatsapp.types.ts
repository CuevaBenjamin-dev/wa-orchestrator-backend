import { AgentConfig, Tenant } from '@prisma/client';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeConversationTurnResult } from '../conversation-engine/ipde-conversation-turn.schemas';
import { IpdePaymentProofDetectionResult } from '../payment-proof/ipde-payment-proof.types';
import { IpdeOutboundExecutionResult } from '../outbound/ipde-outbound-action-executor.types';

export type IpdeWhatsappTenant = Tenant & { agentConfig?: AgentConfig | null };

export interface IpdeWhatsappTextMessage {
  providerMessageId: string;
  from: string;
  text: string;
}

export interface IpdeWhatsappMessageContext {
  tenantId: string;
  tenantName: string;
  leadId: string;
  conversationId: string;
  phoneNumberId: string;
  from: string;
  providerMessageId: string;
  contactName?: string;
}

export interface IpdeWhatsappHandleMessageInput {
  tenant: unknown;
  phoneNumberId: unknown;
  message: unknown;
  contacts: unknown;
}

export interface IpdeWhatsappOutboundPersistenceInput {
  conversationId: string;
  actions: IpdeOutboundAction[];
  execution: IpdeOutboundExecutionResult;
}

export type IpdeWhatsappMessageResult =
  | {
      status: 'ipde_text_processed';
      tenantId: string;
      leadId: string;
      conversationId: string;
      from: string;
      turn: IpdeConversationTurnResult;
      outboundExecution: IpdeOutboundExecutionResult | null;
    }
  | {
      status: 'ipde_payment_proof_processed';
      tenantId: string;
      leadId: string;
      conversationId: string;
      from: string;
      detection: IpdePaymentProofDetectionResult;
      outboundExecution: IpdeOutboundExecutionResult | null;
    }
  | {
      status: 'ipde_media_ignored';
      tenantId: string;
      leadId?: string;
      conversationId?: string;
      from?: string;
      reason: 'MEDIA_NOT_PAYMENT_PROOF' | 'UNSUPPORTED_OR_INVALID_MEDIA';
      detection?: IpdePaymentProofDetectionResult;
    }
  | {
      status: 'duplicated_message_ignored';
      externalId: string;
    }
  | {
      status: 'ignored_empty_message';
      tenantId: string;
      reason: 'TEXT_EMPTY_OR_FROM_MISSING' | 'MESSAGE_ID_MISSING';
    }
  | {
      status: 'ipde_processing_error';
      tenantId?: string;
      externalId?: string;
      errorCode: string;
    };
