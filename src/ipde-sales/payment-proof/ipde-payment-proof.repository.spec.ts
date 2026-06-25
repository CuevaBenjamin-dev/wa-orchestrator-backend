/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
  IpdeOrder,
  IpdeOrderStatus,
  IpdePaymentProof,
  IpdePaymentProofStatus,
  IpdePaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IpdePaymentProofRepository } from './ipde-payment-proof.repository';

const baseNow = new Date('2026-06-25T10:00:00.000Z');

describe('IpdePaymentProofRepository', () => {
  it('creates a proof, moves the active order to review, and pauses automation', async () => {
    const harness = createHarness({
      state: state({
        stage: IpdeConversationStage.WAITING_FOR_PAYMENT,
        activeOrderId: 'order-1',
      }),
      order: order({
        status: IpdeOrderStatus.AWAITING_PAYMENT,
        paymentStatus: IpdePaymentStatus.AWAITING_PROOF,
      }),
    });
    const repository = new IpdePaymentProofRepository(harness.prisma);

    const result = await repository.registerPaymentProof(input());

    expect(result.paymentProof).toMatchObject({
      isDuplicate: false,
      status: IpdePaymentProofStatus.UNDER_REVIEW,
      providerMessageId: 'wamid.1',
      providerMediaId: 'media-1',
    });
    expect(result.order).toMatchObject({
      orderId: 'order-1',
      statusBefore: IpdeOrderStatus.AWAITING_PAYMENT,
      statusAfter: IpdeOrderStatus.PAYMENT_UNDER_REVIEW,
      paymentStatusAfter: IpdePaymentStatus.UNDER_REVIEW,
    });
    expect(result.state).toMatchObject({
      stageBefore: IpdeConversationStage.WAITING_FOR_PAYMENT,
      stageAfter: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
      automationModeAfter: IpdeAutomationMode.PAUSED_HUMAN,
      versionBefore: 1,
      versionAfter: 2,
    });
    expect(result.appliedChanges).toEqual([
      { type: 'PAYMENT_PROOF_CREATED', paymentProofId: 'proof-1' },
      { type: 'ORDER_PAYMENT_UNDER_REVIEW', orderId: 'order-1' },
      { type: 'STATE_PAYMENT_UNDER_REVIEW', stateId: 'state-1' },
      { type: 'AUTOMATION_PAUSED', stateId: 'state-1' },
    ]);
  });

  it('registers a proof without inventing an order when no active order exists', async () => {
    const harness = createHarness({
      state: state({
        stage: IpdeConversationStage.NEW,
        activeOrderId: null,
      }),
      order: null,
    });
    const repository = new IpdePaymentProofRepository(harness.prisma);

    const result = await repository.registerPaymentProof(input());

    expect(result.order.orderId).toBeNull();
    expect(result.appliedChanges).toEqual([
      { type: 'PAYMENT_PROOF_CREATED', paymentProofId: 'proof-1' },
      { type: 'NO_ACTIVE_ORDER' },
      { type: 'STATE_PAYMENT_UNDER_REVIEW', stateId: 'state-1' },
      { type: 'AUTOMATION_PAUSED', stateId: 'state-1' },
    ]);
    expect(harness.order).toBeNull();
  });

  it('returns the existing proof without repeating transitions for duplicates', async () => {
    const existingProof = proof({
      id: 'proof-existing',
      providerMessageId: 'wamid.1',
      providerMediaId: 'media-1',
      orderId: 'order-1',
    });
    const harness = createHarness({
      state: state({
        stage: IpdeConversationStage.WAITING_FOR_PAYMENT,
        activeOrderId: 'order-1',
      }),
      order: order({
        status: IpdeOrderStatus.AWAITING_PAYMENT,
        paymentStatus: IpdePaymentStatus.AWAITING_PROOF,
      }),
      proofs: [existingProof],
    });
    const repository = new IpdePaymentProofRepository(harness.prisma);

    const result = await repository.registerPaymentProof(input());

    expect(result.paymentProof).toMatchObject({
      paymentProofId: 'proof-existing',
      isDuplicate: true,
    });
    expect(result.appliedChanges).toEqual([]);
    expect(harness.proofs).toHaveLength(1);
    expect(harness.state.stateVersion).toBe(1);
    expect(harness.order?.status).toBe(IpdeOrderStatus.AWAITING_PAYMENT);
  });

  it('keeps an already paused conversation paused when receiving a proof', async () => {
    const pausedAt = new Date('2026-06-25T09:00:00.000Z');
    const harness = createHarness({
      state: state({
        stage: IpdeConversationStage.HUMAN_TAKEOVER,
        automationMode: IpdeAutomationMode.PAUSED_HUMAN,
        pauseReason: 'USER_REQUESTED_HUMAN',
        pausedAt,
        activeOrderId: null,
      }),
      order: null,
    });
    const repository = new IpdePaymentProofRepository(harness.prisma);

    const result = await repository.registerPaymentProof(input());

    expect(result.state.automationModeAfter).toBe(
      IpdeAutomationMode.PAUSED_HUMAN,
    );
    expect(harness.state.pausedAt).toBe(pausedAt);
    expect(result.appliedChanges).toEqual([
      { type: 'PAYMENT_PROOF_CREATED', paymentProofId: 'proof-1' },
      { type: 'NO_ACTIVE_ORDER' },
      { type: 'STATE_PAYMENT_UNDER_REVIEW', stateId: 'state-1' },
    ]);
  });
});

function input() {
  return {
    tenantCode: 'IPDE' as const,
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    provider: 'WHATSAPP' as const,
    providerMessageId: 'wamid.1',
    providerMediaId: 'media-1',
    mediaType: 'image' as const,
    mimeType: 'image/png' as const,
    caption: 'Comprobante',
  };
}

function createHarness(params: {
  state?: IpdeConversationState | null;
  order?: IpdeOrder | null;
  proofs?: IpdePaymentProof[];
}) {
  const harness = {
    state: params.state ?? null,
    order: params.order ?? null,
    proofs: [...(params.proofs ?? [])],
    prisma: null as unknown as PrismaService,
  };

  const transaction = {
    conversation: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          where.id === 'conversation-1' &&
            where.tenantId === 'tenant-1' &&
            where.leadId === 'lead-1'
            ? { id: 'conversation-1' }
            : null,
        ),
      ),
    },
    ipdeConversationState: {
      upsert: jest.fn(({ create }) => {
        if (!harness.state) {
          harness.state = state({
            id: 'state-created',
            tenantId: create.tenantId,
            leadId: create.leadId,
            conversationId: create.conversationId,
          });
        }
        return Promise.resolve(harness.state);
      }),
      updateMany: jest.fn(({ where, data }) => {
        if (
          !harness.state ||
          harness.state.id !== where.id ||
          harness.state.tenantId !== where.tenantId ||
          harness.state.stateVersion !== where.stateVersion
        ) {
          return Promise.resolve({ count: 0 });
        }
        const increment =
          typeof data.stateVersion?.increment === 'number'
            ? data.stateVersion.increment
            : 0;
        harness.state = {
          ...harness.state,
          ...data,
          stateVersion: harness.state.stateVersion + increment,
          updatedAt: baseNow,
        };
        return Promise.resolve({ count: 1 });
      }),
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          harness.state?.id === where.id &&
            harness.state.tenantId === where.tenantId
            ? harness.state
            : null,
        ),
      ),
    },
    ipdeOrder: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          harness.order &&
            harness.order.id === where.id &&
            harness.order.tenantId === where.tenantId &&
            harness.order.conversationStateId === where.conversationStateId
            ? harness.order
            : null,
        ),
      ),
      update: jest.fn(({ data }) => {
        harness.order = {
          ...harness.order!,
          ...data,
          updatedAt: baseNow,
        };
        return Promise.resolve(harness.order);
      }),
    },
    ipdePaymentProof: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          harness.proofs.find((item) => matchesProofWhere(item, where)) ?? null,
        ),
      ),
      create: jest.fn(({ data }) => {
        const item = proof({
          id: `proof-${harness.proofs.length + 1}`,
          tenantId: data.tenantId,
          orderId: data.orderId ?? null,
          conversationStateId: data.conversationStateId ?? null,
          conversationId: data.conversationId ?? null,
          leadId: data.leadId ?? null,
          status: data.status,
          provider: data.provider,
          providerMessageId: data.providerMessageId ?? null,
          providerMediaId: data.providerMediaId,
          mediaType: data.mediaType,
          mimeType: data.mimeType ?? null,
          fileName: data.fileName ?? null,
          caption: data.caption ?? null,
          sha256: data.sha256 ?? null,
          receivedAt: data.receivedAt ?? baseNow,
        });
        harness.proofs.push(item);
        return Promise.resolve(item);
      }),
    },
  };

  harness.prisma = {
    $transaction: jest.fn((callback) => callback(transaction)),
  } as unknown as PrismaService;

  return harness;
}

function matchesProofWhere(
  item: IpdePaymentProof,
  where: Record<string, unknown>,
): boolean {
  if (item.tenantId !== where.tenantId) return false;
  if (where.providerMessageId !== undefined) {
    return item.providerMessageId === where.providerMessageId;
  }
  if (item.providerMediaId !== where.providerMediaId) return false;
  if (where.orderId !== undefined && item.orderId !== where.orderId) {
    return false;
  }
  if (
    where.conversationId !== undefined &&
    item.conversationId !== where.conversationId
  ) {
    return false;
  }
  return true;
}

function state(
  params: Partial<IpdeConversationState> = {},
): IpdeConversationState {
  return {
    id: 'state-1',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    stage: IpdeConversationStage.NEW,
    automationMode: IpdeAutomationMode.ACTIVE,
    pauseReason: null,
    pausedAt: null,
    resumedAt: null,
    stateVersion: 1,
    lastTransitionAt: baseNow,
    activeOrderId: null,
    createdAt: baseNow,
    updatedAt: baseNow,
    ...params,
  };
}

function order(params: Partial<IpdeOrder> = {}): IpdeOrder {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    conversationStateId: 'state-1',
    status: IpdeOrderStatus.DRAFT,
    paymentStatus: IpdePaymentStatus.NOT_REQUESTED,
    fullName: null,
    normalizedFullName: null,
    fullNameConfirmedAt: null,
    currencyCode: 'PEN',
    quotedAmount: null,
    quoteConfirmedAt: null,
    confirmedAt: null,
    readyForIssuanceAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: baseNow,
    updatedAt: baseNow,
    ...params,
  };
}

function proof(params: Partial<IpdePaymentProof> = {}): IpdePaymentProof {
  return {
    id: 'proof-1',
    tenantId: 'tenant-1',
    orderId: null,
    conversationStateId: 'state-1',
    conversationId: 'conversation-1',
    leadId: 'lead-1',
    status: IpdePaymentProofStatus.UNDER_REVIEW,
    provider: 'WHATSAPP',
    providerMessageId: null,
    providerMediaId: 'media-1',
    mediaType: 'image',
    mimeType: 'image/png',
    fileName: null,
    caption: 'Comprobante',
    sha256: null,
    receivedAt: baseNow,
    reviewedAt: null,
    reviewNotes: null,
    createdAt: baseNow,
    updatedAt: baseNow,
    ...params,
  };
}
