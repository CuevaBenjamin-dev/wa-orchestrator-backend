/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderItemStatus,
  IpdeOrderStatus,
  IpdePaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConcurrentIpdeStateUpdateError } from '../domain/ipde-sales.errors';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeTurnPersistenceService } from './ipde-turn-persistence.service';
import {
  IpdeConversationTurnContext,
  IpdeConversationTurnPlan,
} from './ipde-conversation-turn.types';

const now = new Date('2026-06-22T10:00:00.000Z');

function state(stage = IpdeConversationStage.NEW) {
  return {
    id: 'state-1',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    stage,
    automationMode: IpdeAutomationMode.ACTIVE,
    pauseReason: null,
    pausedAt: null,
    resumedAt: null,
    stateVersion: 1,
    lastTransitionAt: now,
    activeOrderId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function context(
  stage = IpdeConversationStage.NEW,
): IpdeConversationTurnContext {
  return {
    input: {
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      userMessage: 'hola',
      recentMessages: [],
    },
    state: state(stage),
    stateCreated: false,
    order: null,
    presentedLists: [],
  };
}

function plan(
  overrides: Partial<IpdeConversationTurnPlan> = {},
): IpdeConversationTurnPlan {
  return {
    ensureOrder: false,
    subjectMutations: [],
    itemMutations: [],
    completedSubjectNames: [],
    productMutations: [],
    issuerMutations: [],
    nameMutation: null,
    quoteMutation: null,
    targetStage: IpdeConversationStage.NEW,
    outboundActions: [],
    deferredIntents: [],
    ...overrides,
  };
}

function transactionMock() {
  return {
    ipdeConversationState: {
      findFirst: jest.fn().mockResolvedValue(state()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...state(IpdeConversationStage.UNDERSTANDING_REQUEST),
        stateVersion: 2,
      }),
    },
    ipdeOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    ipdeSubjectRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ipdeOrderItem: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

function serviceWith(transaction: ReturnType<typeof transactionMock>) {
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  } as unknown as PrismaService;
  return new IpdeTurnPersistenceService(
    prisma,
    new IpdeStageTransitionPolicy(),
  );
}

describe('IpdeTurnPersistenceService', () => {
  it('applies one optimistic state transition and no order for a greeting', async () => {
    const transaction = transactionMock();
    const service = serviceWith(transaction);
    const result = await service.apply(
      context(),
      plan({ targetStage: IpdeConversationStage.UNDERSTANDING_REQUEST }),
    );
    expect(transaction.ipdeOrder.create).not.toHaveBeenCalled();
    expect(transaction.ipdeConversationState.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(transaction.ipdeConversationState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          stateVersion: 1,
        }),
      }),
    );
    expect(result.appliedChanges).toContainEqual({
      type: 'STAGE_TRANSITIONED',
      from: IpdeConversationStage.NEW,
      to: IpdeConversationStage.UNDERSTANDING_REQUEST,
    });
  });

  it('creates an active order and idempotent subject/item mutations atomically', async () => {
    const transaction = transactionMock();
    const createdOrder = {
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
      createdAt: now,
      updatedAt: now,
    };
    const subject = {
      id: 'subject-1',
      tenantId: 'tenant-1',
      orderId: 'order-1',
      categoryCode: 'DERECHO',
      catalogEntryId: 'DERECHO_CIVIL',
      displayName: 'Derecho Civil',
      normalizedName: 'derecho civil',
      catalogSource: 'MANUAL',
      status: 'REQUESTED',
      listPresentedAt: null,
      selectionCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const item = {
      id: 'item-1',
      tenantId: 'tenant-1',
      orderId: 'order-1',
      subjectRequestId: 'subject-1',
      catalogTopicId: 'CIVIL_1',
      topicName: 'Responsabilidad civil',
      normalizedTopicName: 'responsabilidad civil',
      productTypeCode: null,
      issuerCode: null,
      issuerVariantCode: null,
      status: IpdeOrderItemStatus.DRAFT,
      confirmedAt: null,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    transaction.ipdeOrder.create.mockResolvedValue(createdOrder);
    transaction.ipdeSubjectRequest.create.mockResolvedValue(subject);
    transaction.ipdeSubjectRequest.update.mockResolvedValue({
      ...subject,
      status: 'LIST_PRESENTED',
      listPresentedAt: now,
    });
    transaction.ipdeOrderItem.findUnique.mockResolvedValue(null);
    transaction.ipdeOrderItem.create.mockResolvedValue(item);
    transaction.ipdeOrder.findFirst.mockResolvedValue({
      ...createdOrder,
      subjectRequests: [subject],
      items: [item],
    });
    transaction.ipdeConversationState.findUniqueOrThrow.mockResolvedValue({
      ...state(IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION),
      activeOrderId: 'order-1',
      stateVersion: 2,
    });
    const service = serviceWith(transaction);
    const result = await service.apply(
      context(),
      plan({
        ensureOrder: true,
        targetStage: IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
        subjectMutations: [
          {
            displayName: 'Derecho Civil',
            normalizedName: 'derecho civil',
            categoryCode: 'DERECHO',
            catalogEntryId: 'DERECHO_CIVIL',
            catalogSource: 'MANUAL',
            markListPresented: true,
          },
        ],
        itemMutations: [
          {
            topicName: 'Responsabilidad civil',
            normalizedTopicName: 'responsabilidad civil',
            subjectNormalizedName: 'derecho civil',
            catalogTopicId: 'CIVIL_1',
          },
        ],
      }),
    );
    expect(result.createdOrder).toBe(true);
    expect(result.appliedChanges).toEqual(
      expect.arrayContaining([
        { type: 'ORDER_CREATED', orderId: 'order-1' },
        { type: 'SUBJECT_ADDED', subjectRequestId: 'subject-1' },
        { type: 'ORDER_ITEM_ADDED', orderItemId: 'item-1' },
      ]),
    );
  });

  it('surfaces a version conflict without leaking partial mutations', async () => {
    const transaction = transactionMock();
    transaction.ipdeConversationState.updateMany.mockResolvedValue({
      count: 0,
    });
    const service = serviceWith(transaction);
    await expect(
      service.apply(
        context(),
        plan({ targetStage: IpdeConversationStage.UNDERSTANDING_REQUEST }),
      ),
    ).rejects.toBeInstanceOf(ConcurrentIpdeStateUpdateError);
  });

  it('persists an accepted issuer preference on the tenant order items', async () => {
    const transaction = transactionMock();
    const activeState = { ...state(), activeOrderId: 'order-1' };
    const activeOrder = {
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
      createdAt: now,
      updatedAt: now,
    };
    const item = {
      id: 'item-1',
      tenantId: 'tenant-1',
      orderId: 'order-1',
      subjectRequestId: null,
      catalogTopicId: null,
      topicName: 'Tema comercial',
      normalizedTopicName: 'tema comercial',
      productTypeCode: 'DIPLOMADO',
      issuerCode: null,
      issuerVariantCode: null,
      status: IpdeOrderItemStatus.DRAFT,
      confirmedAt: null,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    transaction.ipdeConversationState.findFirst.mockResolvedValue(activeState);
    transaction.ipdeOrder.findFirst.mockResolvedValue(activeOrder);
    transaction.ipdeOrderItem.findMany.mockResolvedValue([item]);
    const service = serviceWith(transaction);

    const result = await service.apply(
      context(),
      plan({
        issuerMutations: [
          {
            issuerCode: 'CAC',
            issuerVariantCode: 'CAC_DECANO',
            appliesTo: 'ALL',
            correctionExplicit: false,
          },
        ],
      }),
    );

    expect(transaction.ipdeOrderItem.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        orderId: 'order-1',
        status: { not: IpdeOrderItemStatus.REMOVED },
      },
    });
    expect(transaction.ipdeOrderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        issuerCode: 'CAC',
        issuerVariantCode: 'CAC_DECANO',
      }),
    });
    expect(result.appliedChanges).toContainEqual({
      type: 'ISSUER_SELECTION_SET',
      orderItemId: 'item-1',
    });
  });

  it('overwrites an existing issuer only after an explicit correction', async () => {
    const transaction = transactionMock();
    const activeState = { ...state(), activeOrderId: 'order-1' };
    const activeOrder = {
      id: 'order-1',
      tenantId: 'tenant-1',
      conversationStateId: 'state-1',
      fullName: null,
      fullNameConfirmedAt: null,
    };
    transaction.ipdeConversationState.findFirst.mockResolvedValue(activeState);
    transaction.ipdeOrder.findFirst.mockResolvedValue(activeOrder);
    transaction.ipdeOrderItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        tenantId: 'tenant-1',
        orderId: 'order-1',
        subjectRequestId: null,
        normalizedTopicName: 'tema comercial',
        issuerCode: 'UNT',
        issuerVariantCode: 'UNT_POSGRADO',
        status: IpdeOrderItemStatus.CONFIRMED,
        confirmedAt: now,
      },
    ]);
    const service = serviceWith(transaction);

    await service.apply(
      context(),
      plan({
        issuerMutations: [
          {
            issuerCode: 'CAC',
            issuerVariantCode: 'CAC_DECANO',
            appliesTo: 'ALL',
            correctionExplicit: false,
          },
        ],
      }),
    );

    expect(transaction.ipdeOrderItem.update).not.toHaveBeenCalled();

    await service.apply(
      context(),
      plan({
        issuerMutations: [
          {
            issuerCode: 'CAC',
            issuerVariantCode: 'CAC_DECANO',
            appliesTo: 'ALL',
            correctionExplicit: true,
          },
        ],
      }),
    );

    expect(transaction.ipdeOrderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: {
        issuerCode: 'CAC',
        issuerVariantCode: 'CAC_DECANO',
        status: IpdeOrderItemStatus.DRAFT,
        confirmedAt: null,
      },
    });
  });

  it('persists an unconfirmed quote and does not overwrite a confirmed quote', async () => {
    const transaction = transactionMock();
    const activeState = { ...state(), activeOrderId: 'order-1' };
    const activeOrder = {
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
      createdAt: now,
      updatedAt: now,
    };
    transaction.ipdeConversationState.findFirst.mockResolvedValue(activeState);
    transaction.ipdeOrder.findFirst.mockResolvedValue(activeOrder);
    transaction.ipdeOrder.update.mockResolvedValue({
      ...activeOrder,
      quotedAmount: '80.00',
    });
    const service = serviceWith(transaction);

    const result = await service.apply(
      context(),
      plan({
        quoteMutation: {
          amount: '80.00',
          currencyCode: 'PEN',
          confirmed: false,
          correctionExplicit: false,
        },
      }),
    );

    expect(transaction.ipdeOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        quotedAmount: expect.anything(),
        currencyCode: 'PEN',
        quoteConfirmedAt: null,
      },
    });
    expect(result.appliedChanges).toContainEqual({
      type: 'QUOTE_SET',
      orderId: 'order-1',
    });

    transaction.ipdeOrder.update.mockClear();
    transaction.ipdeOrder.findFirst.mockResolvedValue({
      ...activeOrder,
      quotedAmount: { equals: () => false },
      quoteConfirmedAt: now,
    });

    await service.apply(
      context(),
      plan({
        quoteMutation: {
          amount: '70.00',
          currencyCode: 'PEN',
          confirmed: false,
          correctionExplicit: false,
        },
      }),
    );

    expect(transaction.ipdeOrder.update).not.toHaveBeenCalled();
  });

  it('does not touch the state on an idempotent repeated no-op', async () => {
    const transaction = transactionMock();
    const service = serviceWith(transaction);
    const result = await service.apply(context(), plan());
    expect(transaction.ipdeConversationState.updateMany).not.toHaveBeenCalled();
    expect(result.appliedChanges).toEqual([{ type: 'NO_CHANGE' }]);
  });
});
