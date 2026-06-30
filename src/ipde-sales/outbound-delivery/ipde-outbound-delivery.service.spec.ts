import { ConfigService } from '@nestjs/config';
import {
  IpdeOutboundDelivery,
  IpdeOutboundDeliveryStatus,
} from '@prisma/client';
import { WhatsappMessageGatewayService } from '../../whatsapp/whatsapp-message-gateway.service';
import { IpdeCommercialConfigService } from '../commercial-config/ipde-commercial-config.service';
import { IpdeOutboundActionSchema } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeMediaAssetsService } from '../media/ipde-media-assets.service';
import { IpdeMediaStorageService } from '../media/ipde-media-storage.service';
import { IpdeOutboundDeliveryRepository } from './ipde-outbound-delivery.repository';
import {
  IpdeOutboundDeliveryService,
  planOutboundDeliveries,
} from './ipde-outbound-delivery.service';

describe('planOutboundDeliveries', () => {
  it('creates stable sequences for text, chunks and media placeholders', () => {
    const planned = planOutboundDeliveries([
      IpdeOutboundActionSchema.parse({
        type: 'ASK_SUBJECT',
        messageDraft: '¿Qué materia necesitas?',
      }),
      IpdeOutboundActionSchema.parse({
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
      }),
      IpdeOutboundActionSchema.parse({
        type: 'SEND_PAYMENT_METHODS_IMAGE',
        assetId: 'PAYMENT_METHODS_GENERAL',
        messageDraft: 'Te envío los medios de pago.',
      }),
    ]);

    expect(planned.map((delivery) => delivery.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(planned.map((delivery) => delivery.payload.kind)).toEqual([
      'TEXT',
      'TEXT',
      'TEXT',
      'TEXT',
      'IMAGE_ASSET',
    ]);
    expect(JSON.stringify(planned)).not.toMatch(/https?:|token|storageKey/i);
  });
});

describe('IpdeOutboundDeliveryService', () => {
  it('creates deliveries from actions through the idempotent repository', async () => {
    const harness = createHarness();
    harness.repository.createFromPlan.mockResolvedValue([delivery()]);

    await harness.service.createFromActions({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      inboundMessageId: 'message-in-1',
      inboundExternalId: 'wamid.in-1',
      actions: [
        IpdeOutboundActionSchema.parse({
          type: 'ASK_SUBJECT',
          messageDraft: '¿Qué materia necesitas?',
        }),
      ],
    });

    expect(harness.repository.createFromPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        conversationId: 'conversation-1',
        inboundMessageId: 'message-in-1',
        inboundExternalId: 'wamid.in-1',
        maxAttempts: 3,
        planned: [
          expect.objectContaining({
            actionType: 'ASK_SUBJECT',
            sequence: 1,
          }),
        ],
      }),
    );
  });

  it('executes pending deliveries and marks provider success as SENT', async () => {
    const harness = createHarness();
    const pending = delivery();
    const sending = delivery({ attemptCount: 1, status: 'SENDING' });
    const sent = delivery({
      status: 'SENT',
      attemptCount: 1,
      providerMessageId: 'wamid.out-1',
    });
    harness.repository.findExecutableByInbound.mockResolvedValue([pending]);
    harness.repository.markSending.mockResolvedValue(sending);
    harness.gateway.sendText.mockResolvedValue({
      attempted: true,
      success: true,
      simulated: false,
      providerMessageId: 'wamid.out-1',
      errorCode: null,
      errorMessage: null,
    });
    harness.repository.markSent.mockResolvedValue(sent);
    harness.repository.findByInbound.mockResolvedValue([sent]);

    const result =
      await harness.service.executePendingForInbound(executionInput());

    expect(harness.repository.markSent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        providerMessageId: 'wamid.out-1',
      }),
    );
    expect(result).toMatchObject({ attempted: true, sent: 1, failed: 0 });
  });

  it('marks dry-run success as SENT without provider id', async () => {
    const harness = createHarness();
    const sending = delivery({ attemptCount: 1, status: 'SENDING' });
    const sent = delivery({ status: 'SENT', attemptCount: 1 });
    harness.repository.findExecutableByInbound.mockResolvedValue([delivery()]);
    harness.repository.markSending.mockResolvedValue(sending);
    harness.gateway.sendText.mockResolvedValue({
      attempted: false,
      success: true,
      simulated: true,
      providerMessageId: null,
      errorCode: null,
      errorMessage: null,
    });
    harness.repository.markSent.mockResolvedValue(sent);
    harness.repository.findByInbound.mockResolvedValue([sent]);

    await harness.service.executePendingForInbound(executionInput());

    expect(harness.repository.markSent).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: null }),
    );
  });

  it('keeps temporary failures pending and schedules retry', async () => {
    const harness = createHarness();
    harness.repository.findExecutableByInbound.mockResolvedValue([delivery()]);
    harness.repository.markSending.mockResolvedValue(
      delivery({ attemptCount: 1, status: 'SENDING' }),
    );
    harness.gateway.sendText.mockResolvedValue({
      attempted: true,
      success: false,
      simulated: false,
      providerMessageId: null,
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'network failed',
    });
    harness.repository.markPendingRetry.mockResolvedValue(
      delivery({ status: 'PENDING', attemptCount: 1 }),
    );
    harness.repository.findByInbound.mockResolvedValue([
      delivery({ status: 'PENDING', attemptCount: 1 }),
    ]);

    const result =
      await harness.service.executePendingForInbound(executionInput());

    expect(harness.repository.markPendingRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        code: 'NETWORK_ERROR',
      }),
    );
    expect(result.pending).toBe(1);
  });

  it('marks final failure as FAILED and does not reexecute sent deliveries', async () => {
    const harness = createHarness();
    harness.repository.findExecutableByInbound.mockResolvedValue([
      delivery({ attemptCount: 2, maxAttempts: 3 }),
    ]);
    harness.repository.markSending.mockResolvedValue(
      delivery({ attemptCount: 3, maxAttempts: 3, status: 'SENDING' }),
    );
    harness.gateway.sendText.mockResolvedValue({
      attempted: true,
      success: false,
      simulated: false,
      providerMessageId: null,
      errorCode: 'TIMEOUT',
      errorMessage: 'timeout',
    });
    harness.repository.markFailed.mockResolvedValue(
      delivery({ status: 'FAILED' }),
    );
    harness.repository.findByInbound.mockResolvedValue([
      delivery({ status: 'FAILED' }),
      delivery({ id: 'delivery-sent', sequence: 2, status: 'SENT' }),
    ]);

    const result =
      await harness.service.executePendingForInbound(executionInput());

    expect(harness.repository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TIMEOUT' }),
    );
    expect(result).toMatchObject({ failed: 1, sent: 1 });
  });

  it('retryPending respects limit and resolves routing from tenant and lead', async () => {
    const harness = createHarness();
    const pending = {
      ...delivery(),
      tenant: { whatsappPhoneId: 'ipde-phone-id' },
      lead: { phone: '51999999999' },
    };
    harness.repository.findPending.mockResolvedValue([pending]);
    harness.repository.markSending.mockResolvedValue(
      delivery({ attemptCount: 1, status: 'SENDING' }),
    );
    harness.gateway.sendText.mockResolvedValue({
      attempted: false,
      success: true,
      simulated: true,
      providerMessageId: null,
      errorCode: null,
      errorMessage: null,
    });
    harness.repository.markSent.mockResolvedValue(delivery({ status: 'SENT' }));

    await harness.service.retryPending({
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      limit: 1,
    });

    expect(harness.repository.findPending).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', limit: 1 }),
    );
    expect(harness.gateway.sendText).toHaveBeenCalledWith({
      phoneNumberId: 'ipde-phone-id',
      to: '51999999999',
      text: 'Hola desde outbox',
    });
  });
});

function createHarness() {
  const repository = {
    createFromPlan: jest.fn(),
    findExecutableByInbound: jest.fn().mockResolvedValue([]),
    findByInbound: jest.fn().mockResolvedValue([]),
    findPending: jest.fn().mockResolvedValue([]),
    markSending: jest.fn(),
    markSent: jest.fn(),
    markPendingRetry: jest.fn(),
    markFailed: jest.fn(),
    markSkipped: jest.fn(),
  };
  const gateway = {
    sendText: jest.fn(),
    sendImage: jest.fn(),
    sendDocument: jest.fn(),
    uploadMedia: jest.fn(),
  };
  const service = new IpdeOutboundDeliveryService(
    repository as unknown as IpdeOutboundDeliveryRepository,
    gateway as unknown as WhatsappMessageGatewayService,
    { getAssetById: jest.fn() } as unknown as IpdeMediaAssetsService,
    {} as unknown as IpdeMediaStorageService,
    {
      getModelPdfAssetById: jest.fn(),
    } as unknown as IpdeCommercialConfigService,
    new ConfigService({
      WHATSAPP_SEND_ENABLED: 'false',
      IPDE_OUTBOUND_MAX_ATTEMPTS: '3',
      IPDE_OUTBOUND_RETRY_DELAY_SECONDS: '60',
    }),
  );

  return { service, repository, gateway };
}

function executionInput() {
  return {
    tenantCode: 'IPDE' as const,
    tenantId: 'tenant-1',
    phoneNumberId: 'ipde-phone-id',
    to: '51999999999',
    inboundExternalId: 'wamid.in-1',
  };
}

function delivery(
  overrides: Partial<IpdeOutboundDelivery> = {},
): IpdeOutboundDelivery {
  const now = new Date('2026-06-30T12:00:00.000Z');
  return {
    id: 'delivery-1',
    tenantId: 'tenant-1',
    conversationId: 'conversation-1',
    leadId: 'lead-1',
    orderId: null,
    inboundMessageId: 'message-in-1',
    inboundExternalId: 'wamid.in-1',
    actionType: 'ASK_SUBJECT',
    sequence: 1,
    payloadJson: {
      kind: 'TEXT',
      text: 'Hola desde outbox',
      contentForMessage: 'Hola desde outbox',
    },
    status: IpdeOutboundDeliveryStatus.PENDING,
    attemptCount: 0,
    maxAttempts: 3,
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    scheduledAt: now,
    sentAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
