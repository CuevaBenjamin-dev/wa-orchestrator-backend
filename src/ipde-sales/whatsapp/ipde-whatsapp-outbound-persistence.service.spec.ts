import { MessageRole } from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import {
  IpdeOutboundAction,
  IpdeOutboundActionSchema,
} from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeOutboundExecutionResult } from '../outbound/ipde-outbound-action-executor.types';
import { IpdeWhatsappOutboundPersistenceService } from './ipde-whatsapp-outbound-persistence.service';

describe('IpdeWhatsappOutboundPersistenceService', () => {
  it('persists text responses as assistant messages with provider ids when available', async () => {
    const harness = createHarness();

    await harness.service.persistExecutedMessages({
      conversationId: 'conversation-1',
      actions: [
        IpdeOutboundActionSchema.parse({
          type: 'ASK_SUBJECT',
          messageDraft: '¿Qué materia necesitas?',
        }),
      ],
      execution: execution([
        {
          actionType: 'ASK_SUBJECT',
          sequence: 1,
          providerMessageId: 'wamid.out-1',
        },
      ]),
    });

    expect(harness.addMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      role: MessageRole.ASSISTANT,
      content: '¿Qué materia necesitas?',
      externalId: 'wamid.out-1',
      tokensInput: 0,
      tokensOutput: 0,
    });
  });

  it('persists topic list chunks separately and in order', async () => {
    const harness = createHarness();

    await harness.service.persistExecutedMessages({
      conversationId: 'conversation-1',
      actions: [topicListAction()],
      execution: execution([
        { actionType: 'PRESENT_TOPIC_LIST', sequence: 1 },
        { actionType: 'PRESENT_TOPIC_LIST', sequence: 2 },
      ]),
    });

    expect(harness.addMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: 'chunk uno' }),
    );
    expect(harness.addMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ content: 'chunk dos' }),
    );
  });

  it('persists media actions with safe descriptions only', async () => {
    const harness = createHarness();

    await harness.service.persistExecutedMessages({
      conversationId: 'conversation-1',
      actions: [
        IpdeOutboundActionSchema.parse({
          type: 'SEND_PAYMENT_METHODS_IMAGE',
          assetId: 'PAYMENT_METHODS_GENERAL',
          messageDraft: 'Te envío los medios de pago.',
        }),
        IpdeOutboundActionSchema.parse({
          type: 'OFFER_MODEL_PDF_OPTIONS',
          modelPdfAssets: [
            {
              id: 'MODEL_1',
              title: 'Modelo 1',
              description: 'Modelo referencial',
              issuerCode: 'ucv',
              issuerVariantCode: 'ucv_default',
              productTypeCode: 'DIPLOMADO',
            },
          ],
          messageDraft: 'Te comparto un modelo referencial.',
        }),
      ],
      execution: execution([
        { actionType: 'SEND_PAYMENT_METHODS_IMAGE', sequence: 1 },
        { actionType: 'SEND_PAYMENT_METHODS_IMAGE', sequence: 2 },
        { actionType: 'OFFER_MODEL_PDF_OPTIONS', sequence: 3 },
        { actionType: 'OFFER_MODEL_PDF_OPTIONS', sequence: 4 },
      ]),
    });

    const contents = [
      'Te envío los medios de pago.',
      '[Imagen enviada: medios de pago]',
      'Te comparto un modelo referencial.',
      '[Documento enviado: modelo referencial]',
    ];
    expect(contents).toEqual([
      'Te envío los medios de pago.',
      '[Imagen enviada: medios de pago]',
      'Te comparto un modelo referencial.',
      '[Documento enviado: modelo referencial]',
    ]);
    contents.forEach((content, index) => {
      expect(harness.addMessage).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({ content }),
      );
    });
    expect(contents.join('\n')).not.toMatch(/https?:|token|storageKey/i);
  });

  it('does not persist non-executed no-response actions', async () => {
    const harness = createHarness();

    await expect(
      harness.service.persistExecutedMessages({
        conversationId: 'conversation-1',
        actions: [
          IpdeOutboundActionSchema.parse({
            type: 'NO_AUTOMATED_RESPONSE',
            reason: 'PAYMENT_UNDER_REVIEW',
          }),
        ],
        execution: execution([]),
      }),
    ).resolves.toBe(0);
    expect(harness.addMessage).not.toHaveBeenCalled();
  });
});

function createHarness() {
  const addMessage = jest.fn().mockResolvedValue({ id: 'assistant-message-1' });
  const conversations = {
    addMessage,
  } as unknown as ConversationsService;

  return {
    addMessage,
    service: new IpdeWhatsappOutboundPersistenceService(conversations),
  };
}

function execution(
  items: Array<{
    actionType: string;
    sequence: number;
    providerMessageId?: string | null;
  }>,
): IpdeOutboundExecutionResult {
  return {
    attempted: items.length > 0,
    simulated: true,
    actionResults: items.map((item) => ({
      actionType: item.actionType,
      sequence: item.sequence,
      attempted: false,
      success: true,
      simulated: true,
      providerMessageId: item.providerMessageId ?? null,
      errorCode: null,
    })),
  };
}

function topicListAction(): IpdeOutboundAction {
  return IpdeOutboundActionSchema.parse({
    type: 'PRESENT_TOPIC_LIST',
    subjectCatalogEntryId: 'SUBJECT_1',
    subjectDisplayName: 'Derecho Civil',
    source: 'MANUAL',
    topics: Array.from({ length: 25 }, (_value, index) => ({
      position: index + 1,
      topicId: `TOPIC_${index + 1}`,
      topicName: `Tema ${index + 1}`,
    })),
    chunks: [
      { sequence: 1, text: 'chunk uno' },
      { sequence: 2, text: 'chunk dos' },
    ],
    messageDraft: 'chunk uno\n\nchunk dos',
  });
}
