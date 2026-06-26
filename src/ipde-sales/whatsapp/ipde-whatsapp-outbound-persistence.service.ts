import { Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeOutboundExecutionActionResult } from '../outbound/ipde-outbound-action-executor.types';
import { IpdeWhatsappOutboundPersistenceInput } from './ipde-whatsapp.types';

interface PlannedOutboundMessage {
  actionType: string;
  content: string;
}

@Injectable()
export class IpdeWhatsappOutboundPersistenceService {
  constructor(private readonly conversations: ConversationsService) {}

  async persistExecutedMessages(
    input: IpdeWhatsappOutboundPersistenceInput,
  ): Promise<number> {
    const planned = expandActions(input.actions);
    let persisted = 0;

    for (const result of input.execution.actionResults) {
      const message = planned[result.sequence - 1];
      if (!message || message.actionType !== result.actionType) {
        continue;
      }

      await this.persistOne(input.conversationId, message, result);
      persisted += 1;
    }

    return persisted;
  }

  private persistOne(
    conversationId: string,
    message: PlannedOutboundMessage,
    result: IpdeOutboundExecutionActionResult,
  ): Promise<unknown> {
    return this.conversations.addMessage({
      conversationId,
      role: MessageRole.ASSISTANT,
      content: message.content,
      externalId: result.providerMessageId ?? undefined,
      tokensInput: 0,
      tokensOutput: 0,
    });
  }
}

function expandActions(
  actions: IpdeOutboundAction[],
): PlannedOutboundMessage[] {
  return actions.flatMap((action): PlannedOutboundMessage[] => {
    switch (action.type) {
      case 'NO_AUTOMATED_RESPONSE':
      case 'DEFERRED_COMMERCIAL_REQUEST':
        return [];
      case 'PRESENT_TOPIC_LIST':
        return action.chunks.map((chunk) => ({
          actionType: action.type,
          content: chunk.text,
        }));
      case 'SEND_PAYMENT_METHODS_IMAGE':
        return [
          { actionType: action.type, content: action.messageDraft },
          {
            actionType: action.type,
            content: '[Imagen enviada: medios de pago]',
          },
        ];
      case 'SEND_PROMOTION_IMAGE':
        return [
          { actionType: action.type, content: action.messageDraft },
          { actionType: action.type, content: '[Imagen enviada: promoción]' },
        ];
      case 'OFFER_MODEL_PDF_OPTIONS':
        return [
          { actionType: action.type, content: action.messageDraft },
          ...action.modelPdfAssets.map(() => ({
            actionType: action.type,
            content: '[Documento enviado: modelo referencial]',
          })),
        ];
      default:
        return [{ actionType: action.type, content: action.messageDraft }];
    }
  });
}
