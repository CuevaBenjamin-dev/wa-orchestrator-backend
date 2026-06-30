import { ConfigService } from '@nestjs/config';
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderStatus,
  IpdePaymentProofStatus,
  IpdePaymentStatus,
  MessageRole,
} from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import { LeadsService } from '../../leads/leads.service';
import { UsageService } from '../../usage/usage.service';
import { IpdeConversationTurnResult } from '../conversation-engine/ipde-conversation-turn.schemas';
import { IpdeConversationTurnService } from '../conversation-engine/ipde-conversation-turn.service';
import { IpdeOrderService } from '../services/ipde-order.service';
import { IpdeConversationStateService } from '../services/ipde-conversation-state.service';
import { IpdeOutboundDeliveryService } from '../outbound-delivery/ipde-outbound-delivery.service';
import { IpdeOutboundDeliveryExecutionResult } from '../outbound-delivery/ipde-outbound-delivery.types';
import { IpdePaymentProofDetectorService } from '../payment-proof/ipde-payment-proof-detector.service';
import { IpdePaymentProofService } from '../payment-proof/ipde-payment-proof.service';
import {
  IpdePaymentProofDetectionResult,
  IpdePaymentProofRegistrationResult,
} from '../payment-proof/ipde-payment-proof.types';
import { IpdeWhatsappMessageMapperService } from './ipde-whatsapp-message-mapper.service';
import { IpdeWhatsappOrchestratorService } from './ipde-whatsapp-orchestrator.service';
import { IpdeWhatsappOutboundPersistenceService } from './ipde-whatsapp-outbound-persistence.service';

describe('IpdeWhatsappOrchestratorService', () => {
  it('processes IPDE text through the turn engine and persists inbound before outbound', async () => {
    const harness = createHarness();

    const result = await harness.service.handleIncomingMessage(textInput());

    expect(result).toMatchObject({
      status: 'ipde_text_processed',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      from: '51999999999',
    });
    expect(harness.conversations.addMessage).toHaveBeenNthCalledWith(1, {
      conversationId: 'conversation-1',
      role: MessageRole.USER,
      content: 'Quiero precio',
      externalId: 'wamid.text-1',
    });
    expect(harness.usage.incrementInboundMessage).toHaveBeenCalledWith(
      'tenant-1',
    );
    expect(harness.turns.processTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantCode: 'IPDE',
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        conversationId: 'conversation-1',
        turnId: 'wamid.text-1',
        userMessage: 'Quiero precio',
        recentMessages: [{ role: 'ASSISTANT', content: 'Mensaje previo' }],
      }),
    );
    expect(harness.usage.incrementAiUsage).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      tokensInput: 31,
      tokensOutput: 7,
    });
    expect(harness.deliveries.createFromActions).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      orderId: undefined,
      inboundMessageId: 'inbound-1',
      inboundExternalId: 'wamid.text-1',
      actions: defaultTurn().outboundActions,
    });
    expect(harness.deliveries.executePendingForInbound).toHaveBeenCalledWith({
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      phoneNumberId: 'ipde-phone-id',
      to: '51999999999',
      inboundExternalId: 'wamid.text-1',
    });
    expect(
      harness.outboundPersistence.persistDeliveredMessages,
    ).toHaveBeenCalledWith({
      deliveries: defaultDeliveryExecution().deliveries,
    });
  });

  it('does not execute outbound actions when the text engine pauses automation', async () => {
    const harness = createHarness({
      turn: turnWithNoAutomatedResponse(),
    });

    const result = await harness.service.handleIncomingMessage(textInput());

    expect(result).toMatchObject({
      status: 'ipde_text_processed',
      outboundExecution: null,
    });
    expect(harness.deliveries.createFromActions).not.toHaveBeenCalled();
    expect(harness.deliveries.executePendingForInbound).not.toHaveBeenCalled();
    expect(
      harness.outboundPersistence.persistDeliveredMessages,
    ).not.toHaveBeenCalled();
  });

  it('retries pending outbox on duplicated WhatsApp messages without calling the engine', async () => {
    const harness = createHarness({
      existingExternalMessage: { id: 'already-processed' },
    });

    await expect(
      harness.service.handleIncomingMessage(textInput()),
    ).resolves.toMatchObject({
      status: 'duplicated_message_ignored',
      externalId: 'wamid.text-1',
    });
    expect(harness.leads.findOrCreateLead).not.toHaveBeenCalled();
    expect(harness.turns.processTurn).not.toHaveBeenCalled();
    expect(harness.deliveries.executePendingForInbound).toHaveBeenCalledWith({
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      phoneNumberId: 'ipde-phone-id',
      to: '51999999999',
      inboundExternalId: 'wamid.text-1',
    });
    expect(
      harness.outboundPersistence.persistDeliveredMessages,
    ).toHaveBeenCalled();
  });

  it('returns a structured processing error if the text engine fails', async () => {
    const harness = createHarness();
    harness.turns.processTurn.mockRejectedValueOnce(new Error('engine failed'));

    await expect(
      harness.service.handleIncomingMessage(textInput()),
    ).resolves.toMatchObject({
      status: 'ipde_processing_error',
      tenantId: 'tenant-1',
      externalId: 'wamid.text-1',
      errorCode: 'Error',
    });
    expect(harness.deliveries.createFromActions).not.toHaveBeenCalled();
  });

  it('registers probable image payment proofs without calling the text engine', async () => {
    const harness = createHarness({
      detection: {
        kind: 'CONFIRMED_PAYMENT_PROOF',
        confidence: 'HIGH',
        reason: 'MEDIA_IN_PAYMENT_CONTEXT',
        matchedKeywords: ['yape'],
      },
    });

    const result = await harness.service.handleIncomingMessage(imageInput());

    expect(result).toMatchObject({
      status: 'ipde_payment_proof_processed',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      from: '51999999999',
    });
    expect(harness.turns.processTurn).not.toHaveBeenCalled();
    expect(harness.conversations.addMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      role: MessageRole.USER,
      content: '[Imagen recibida]',
      externalId: 'wamid.image-1',
    });
    expect(harness.paymentProofs.registerPaymentProof).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantCode: 'IPDE',
        provider: 'WHATSAPP',
        providerMessageId: 'wamid.image-1',
        providerMediaId: 'media-image-1',
        mediaType: 'image',
        mimeType: 'image/jpeg',
        caption: 'voucher yape',
      }),
    );
    expect(harness.deliveries.createFromActions).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: defaultProofRegistration().outboundActions,
      }),
    );
  });

  it('registers probable PDF payment proofs without invoking OpenAI text flow', async () => {
    const harness = createHarness({
      detection: {
        kind: 'POSSIBLE_PAYMENT_PROOF',
        confidence: 'MEDIUM',
        reason: 'KEYWORD_MATCH_WITHOUT_PAYMENT_CONTEXT',
        matchedKeywords: ['comprobante'],
      },
    });

    await expect(
      harness.service.handleIncomingMessage(documentInput()),
    ).resolves.toMatchObject({
      status: 'ipde_payment_proof_processed',
    });
    expect(harness.turns.processTurn).not.toHaveBeenCalled();
    expect(harness.paymentProofs.registerPaymentProof).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: 'wamid.doc-1',
        providerMediaId: 'media-doc-1',
        mediaType: 'document',
        mimeType: 'application/pdf',
        fileName: 'comprobante.pdf',
      }),
    );
  });

  it('stores non-proof media safely and sends no automated response', async () => {
    const harness = createHarness({
      detection: {
        kind: 'POSSIBLE_PAYMENT_PROOF',
        confidence: 'LOW',
        reason: 'MEDIA_WITHOUT_PAYMENT_CONTEXT',
        matchedKeywords: [],
      },
    });

    await expect(
      harness.service.handleIncomingMessage(
        imageInput({ caption: 'foto aula' }),
      ),
    ).resolves.toMatchObject({
      status: 'ipde_media_ignored',
      reason: 'MEDIA_NOT_PAYMENT_PROOF',
      conversationId: 'conversation-1',
    });
    expect(harness.paymentProofs.registerPaymentProof).not.toHaveBeenCalled();
    expect(harness.turns.processTurn).not.toHaveBeenCalled();
    expect(harness.deliveries.createFromActions).not.toHaveBeenCalled();
    expect(harness.deliveries.executePendingForInbound).not.toHaveBeenCalled();
  });

  it('does not answer text while payment is already under review when engine says no automation', async () => {
    const harness = createHarness({
      turn: turnWithNoAutomatedResponse(),
    });

    await harness.service.handleIncomingMessage(
      textInput({ id: 'wamid.text-2' }),
    );

    expect(harness.deliveries.createFromActions).not.toHaveBeenCalled();
    expect(
      harness.outboundPersistence.persistDeliveredMessages,
    ).not.toHaveBeenCalled();
  });
});

interface HarnessOverrides {
  existingExternalMessage?: unknown;
  turn?: IpdeConversationTurnResult;
  detection?: IpdePaymentProofDetectionResult;
  proof?: IpdePaymentProofRegistrationResult;
}

function createHarness(overrides: HarnessOverrides = {}) {
  const mapper = new IpdeWhatsappMessageMapperService(
    new ConfigService({ IPDE_WHATSAPP_PHONE_ID: 'ipde-phone-id' }),
  );
  const leads = {
    findOrCreateLead: jest.fn().mockResolvedValue({ id: 'lead-1' }),
  };
  const conversations = {
    findByExternalId: jest
      .fn()
      .mockResolvedValue(overrides.existingExternalMessage ?? null),
    findOrCreateConversation: jest
      .fn()
      .mockResolvedValue({ id: 'conversation-1' }),
    addMessage: jest.fn().mockResolvedValue({ id: 'inbound-1' }),
    getRecentMessages: jest.fn().mockResolvedValue([
      {
        id: 'previous-assistant-message',
        role: MessageRole.ASSISTANT,
        content: 'Mensaje previo',
      },
      {
        id: 'inbound-1',
        role: MessageRole.USER,
        content: 'Mensaje entrante actual',
      },
    ]),
  };
  const usage = {
    incrementInboundMessage: jest.fn().mockResolvedValue(undefined),
    incrementAiUsage: jest.fn().mockResolvedValue(undefined),
  };
  const turns = {
    processTurn: jest.fn().mockResolvedValue(overrides.turn ?? defaultTurn()),
  };
  const deliveries = {
    createFromActions: jest.fn().mockResolvedValue([]),
    executePendingForInbound: jest
      .fn()
      .mockResolvedValue(defaultDeliveryExecution()),
  };
  const outboundPersistence = {
    persistDeliveredMessages: jest.fn().mockResolvedValue(1),
  };
  const paymentProofs = {
    registerPaymentProof: jest
      .fn()
      .mockResolvedValue(overrides.proof ?? defaultProofRegistration()),
  };
  const paymentProofDetector = {
    detect: jest.fn().mockReturnValue(overrides.detection ?? lowDetection()),
  };
  const states = {
    getState: jest.fn().mockResolvedValue({
      stage: IpdeConversationStage.WAITING_FOR_PAYMENT,
    }),
  };
  const orders = {
    getActiveOrder: jest.fn().mockResolvedValue({
      paymentStatus: IpdePaymentStatus.AWAITING_PROOF,
      quotedAmount: '100.00',
    }),
  };
  const service = new IpdeWhatsappOrchestratorService(
    mapper,
    leads as unknown as LeadsService,
    conversations as unknown as ConversationsService,
    usage as unknown as UsageService,
    turns as unknown as IpdeConversationTurnService,
    deliveries as unknown as IpdeOutboundDeliveryService,
    outboundPersistence as unknown as IpdeWhatsappOutboundPersistenceService,
    paymentProofs as unknown as IpdePaymentProofService,
    paymentProofDetector as unknown as IpdePaymentProofDetectorService,
    states as unknown as IpdeConversationStateService,
    orders as unknown as IpdeOrderService,
  );

  return {
    service,
    leads,
    conversations,
    usage,
    turns,
    deliveries,
    outboundPersistence,
    paymentProofs,
    paymentProofDetector,
    states,
    orders,
  };
}

function textInput(overrides: Record<string, unknown> = {}) {
  return {
    tenant: tenant(),
    phoneNumberId: 'ipde-phone-id',
    message: {
      id: 'wamid.text-1',
      from: '51999999999',
      type: 'text',
      text: { body: 'Quiero precio' },
      ...overrides,
    },
    contacts: [{ wa_id: '51999999999', profile: { name: 'Benja' } }],
  };
}

function imageInput(overrides: Record<string, unknown> = {}) {
  return {
    tenant: tenant(),
    phoneNumberId: 'ipde-phone-id',
    message: {
      id: 'wamid.image-1',
      from: '51999999999',
      type: 'image',
      image: {
        id: 'media-image-1',
        mime_type: 'image/jpeg',
        caption: 'voucher yape',
        ...overrides,
      },
    },
    contacts: [{ wa_id: '51999999999', profile: { name: 'Benja' } }],
  };
}

function documentInput() {
  return {
    tenant: tenant(),
    phoneNumberId: 'ipde-phone-id',
    message: {
      id: 'wamid.doc-1',
      from: '51999999999',
      type: 'document',
      document: {
        id: 'media-doc-1',
        mime_type: 'application/pdf',
        filename: 'comprobante.pdf',
      },
    },
    contacts: [{ wa_id: '51999999999', profile: { name: 'Benja' } }],
  };
}

function tenant(): Record<string, unknown> {
  return {
    id: 'tenant-1',
    name: 'IPDE',
    businessType: 'education',
    whatsappPhoneId: 'ipde-phone-id',
    status: 'ACTIVE',
  };
}

function defaultTurn(): IpdeConversationTurnResult {
  return {
    turnId: 'wamid.text-1',
    state: {
      stageBefore: IpdeConversationStage.NEW,
      stageAfter: IpdeConversationStage.UNDERSTANDING_REQUEST,
      automationMode: IpdeAutomationMode.ACTIVE,
      versionBefore: 1,
      versionAfter: 2,
    },
    order: {
      orderId: null,
      status: null,
      createdDuringTurn: false,
    },
    understanding: {
      primaryIntent: 'PRICE',
      requestPath: 'UNDETERMINED',
      subjectCount: 0,
      topicSelectionCount: 0,
      needsClarification: false,
    },
    catalogResolution: null,
    appliedChanges: [{ type: 'NO_CHANGE' }],
    outboundActions: [
      {
        type: 'ASK_SUBJECT',
        messageDraft: '¿Qué materia necesitas?',
      },
    ],
    deferredIntents: [],
    metadata: {
      openAiCalls: 1,
      tokensInput: 31,
      tokensOutput: 7,
      latencyMs: 5,
      usedFallback: false,
      concurrentRetryCount: 0,
    },
  };
}

function turnWithNoAutomatedResponse(): IpdeConversationTurnResult {
  return {
    ...defaultTurn(),
    outboundActions: [
      {
        type: 'NO_AUTOMATED_RESPONSE',
        reason: 'PAYMENT_UNDER_REVIEW',
      },
    ],
    metadata: {
      openAiCalls: 0,
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 1,
      usedFallback: false,
      concurrentRetryCount: 0,
    },
  };
}

function defaultDeliveryExecution(): IpdeOutboundDeliveryExecutionResult {
  return {
    attempted: true,
    sent: 1,
    failed: 0,
    pending: 0,
    skipped: 0,
    deliveries: [],
  };
}

function lowDetection(): IpdePaymentProofDetectionResult {
  return {
    kind: 'POSSIBLE_PAYMENT_PROOF',
    confidence: 'LOW',
    reason: 'MEDIA_WITHOUT_PAYMENT_CONTEXT',
    matchedKeywords: [],
  };
}

function defaultProofRegistration(): IpdePaymentProofRegistrationResult {
  return {
    paymentProof: {
      paymentProofId: 'payment-proof-1',
      status: IpdePaymentProofStatus.RECEIVED,
      isDuplicate: false,
      providerMessageId: 'wamid.image-1',
      providerMediaId: 'media-image-1',
    },
    order: {
      orderId: 'order-1',
      statusBefore: IpdeOrderStatus.DRAFT,
      statusAfter: IpdeOrderStatus.DRAFT,
      paymentStatusBefore: IpdePaymentStatus.AWAITING_PROOF,
      paymentStatusAfter: IpdePaymentStatus.UNDER_REVIEW,
    },
    state: {
      stateId: 'state-1',
      stageBefore: IpdeConversationStage.WAITING_FOR_PAYMENT,
      stageAfter: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
      automationModeBefore: IpdeAutomationMode.ACTIVE,
      automationModeAfter: IpdeAutomationMode.PAUSED_HUMAN,
      versionBefore: 1,
      versionAfter: 2,
    },
    appliedChanges: [
      { type: 'PAYMENT_PROOF_CREATED', paymentProofId: 'payment-proof-1' },
      { type: 'ORDER_PAYMENT_UNDER_REVIEW', orderId: 'order-1' },
      { type: 'STATE_PAYMENT_UNDER_REVIEW', stateId: 'state-1' },
      { type: 'AUTOMATION_PAUSED', stateId: 'state-1' },
    ],
    outboundActions: [
      {
        type: 'PAYMENT_PROOF_RECEIVED',
        messageDraft:
          'Perfecto, ya recibí tu comprobante. Vamos a verificarlo con el equipo.',
      },
    ],
  };
}
