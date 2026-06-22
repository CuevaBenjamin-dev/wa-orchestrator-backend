import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
  IpdeOrder,
  IpdeOrderItem,
  IpdeOrderItemStatus,
  IpdeOrderStatus,
  IpdePaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DuplicateIpdeOrderItemError,
  IpdeConversationStateNotFoundError,
} from '../domain/ipde-sales.errors';
import { IpdeOrderRepository } from './ipde-order.repository';

const now = new Date('2026-06-17T00:00:00.000Z');

function conversationState(): IpdeConversationState {
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
    lastTransitionAt: now,
    activeOrderId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function newOrder(id: string): IpdeOrder {
  return {
    id,
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
}

describe('IpdeOrderRepository active order transaction', () => {
  let state: IpdeConversationState;
  let orders: IpdeOrder[];
  let repository: IpdeOrderRepository;

  beforeEach(() => {
    state = conversationState();
    orders = [];
    let transactionQueue: Promise<void> = Promise.resolve();

    const transactionClient = {
      ipdeConversationState: {
        findFirst: jest.fn(
          (args: { where: { tenantId: string; conversationId: string } }) =>
            Promise.resolve(
              args.where.tenantId === state.tenantId &&
                args.where.conversationId === state.conversationId
                ? { ...state }
                : null,
            ),
        ),
        updateMany: jest.fn(
          (args: {
            where: {
              id: string;
              tenantId: string;
              activeOrderId: string | null;
            };
            data: { activeOrderId: string | null };
          }) => {
            const matches =
              args.where.id === state.id &&
              args.where.tenantId === state.tenantId &&
              args.where.activeOrderId === state.activeOrderId;
            if (matches) {
              state = { ...state, activeOrderId: args.data.activeOrderId };
            }
            return Promise.resolve({ count: matches ? 1 : 0 });
          },
        ),
      },
      ipdeOrder: {
        findFirst: jest.fn(
          (args: {
            where: {
              id: string;
              tenantId: string;
              conversationStateId?: string;
            };
          }) =>
            Promise.resolve(
              orders.find(
                (candidate) =>
                  candidate.id === args.where.id &&
                  candidate.tenantId === args.where.tenantId &&
                  (args.where.conversationStateId === undefined ||
                    candidate.conversationStateId ===
                      args.where.conversationStateId),
              ) ?? null,
            ),
        ),
        create: jest.fn(() => {
          const created = newOrder(`order-${orders.length + 1}`);
          orders.push(created);
          return Promise.resolve(created);
        }),
        update: jest.fn(
          (args: {
            where: { id: string };
            data: {
              status?: IpdeOrderStatus;
              completedAt?: Date;
              cancelledAt?: Date;
            };
          }) => {
            const index = orders.findIndex(
              (candidate) => candidate.id === args.where.id,
            );
            const updated = {
              ...orders[index],
              ...args.data,
              updatedAt: now,
            };
            orders[index] = updated;
            return Promise.resolve(updated);
          },
        ),
      },
    } as unknown as Prisma.TransactionClient;

    const prisma = {
      $transaction: jest.fn(
        <T>(action: (client: Prisma.TransactionClient) => Promise<T>) => {
          const result = transactionQueue.then(() => action(transactionClient));
          transactionQueue = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      ),
    } as unknown as PrismaService;

    repository = new IpdeOrderRepository(prisma);
  });

  it('returns one active order for two concurrent calls', async () => {
    const params = { tenantId: 'tenant-1', conversationId: 'conversation-1' };

    const [first, second] = await Promise.all([
      repository.getOrCreateActiveOrder(params),
      repository.getOrCreateActiveOrder(params),
    ]);

    expect(first.id).toBe(second.id);
    expect(orders).toHaveLength(1);
    expect(state.activeOrderId).toBe(first.id);
  });

  it('rejects an active-order request from another tenant', async () => {
    await expect(
      repository.getOrCreateActiveOrder({
        tenantId: 'tenant-2',
        conversationId: 'conversation-1',
      }),
    ).rejects.toBeInstanceOf(IpdeConversationStateNotFoundError);
  });

  it('keeps the completed order as history and creates a new active order', async () => {
    const params = { tenantId: 'tenant-1', conversationId: 'conversation-1' };
    const first = await repository.getOrCreateActiveOrder(params);

    await repository.changeOrderStatus({
      tenantId: 'tenant-1',
      orderId: first.id,
      nextStatus: IpdeOrderStatus.COMPLETED,
    });
    const second = await repository.getOrCreateActiveOrder(params);

    expect(second.id).not.toBe(first.id);
    expect(orders).toHaveLength(2);
    expect(orders[0].status).toBe(IpdeOrderStatus.COMPLETED);
    expect(state.activeOrderId).toBe(second.id);
  });
});

describe('IpdeOrderRepository item restoration', () => {
  function removedItem(overrides: Partial<IpdeOrderItem> = {}): IpdeOrderItem {
    return {
      id: 'item-1',
      tenantId: 'tenant-1',
      orderId: 'order-1',
      subjectRequestId: null,
      catalogTopicId: null,
      topicName: 'Contratos civiles',
      normalizedTopicName: 'contratos civiles',
      productTypeCode: null,
      issuerCode: null,
      issuerVariantCode: null,
      status: IpdeOrderItemStatus.REMOVED,
      confirmedAt: null,
      removedAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function createRepository(existing: IpdeOrderItem): IpdeOrderRepository {
    const transactionClient = {
      ipdeOrder: {
        findFirst: jest.fn(() => Promise.resolve(newOrder('order-1'))),
      },
      ipdeSubjectRequest: {
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      ipdeOrderItem: {
        findUnique: jest.fn(() => Promise.resolve(existing)),
        update: jest.fn(
          (args: {
            data: {
              subjectRequestId?: string;
              catalogTopicId?: string;
              topicName: string;
              status: IpdeOrderItemStatus;
              removedAt: null;
              confirmedAt: null;
            };
          }) =>
            Promise.resolve({
              ...existing,
              ...args.data,
              subjectRequestId: args.data.subjectRequestId ?? null,
              catalogTopicId: args.data.catalogTopicId ?? null,
            }),
        ),
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      $transaction: jest.fn(
        <T>(action: (client: Prisma.TransactionClient) => Promise<T>) =>
          action(transactionClient),
      ),
    } as unknown as PrismaService;
    return new IpdeOrderRepository(prisma);
  }

  it('restores a REMOVED item instead of creating a duplicate', async () => {
    const repository = createRepository(removedItem());

    const restored = await repository.addOrRestoreOrderItem({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      topicName: 'Contratos civiles',
      normalizedTopicName: 'contratos civiles',
    });

    expect(restored.status).toBe(IpdeOrderItemStatus.DRAFT);
    expect(restored.removedAt).toBeNull();
  });

  it('rejects an existing item that is not removed', async () => {
    const repository = createRepository(
      removedItem({ status: IpdeOrderItemStatus.DRAFT }),
    );

    await expect(
      repository.addOrRestoreOrderItem({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        topicName: 'Contratos civiles',
        normalizedTopicName: 'contratos civiles',
      }),
    ).rejects.toBeInstanceOf(DuplicateIpdeOrderItemError);
  });
});
