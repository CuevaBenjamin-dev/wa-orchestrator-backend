import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConcurrentIpdeStateUpdateError } from '../domain/ipde-sales.errors';
import { IpdeConversationStateRepository } from './ipde-conversation-state.repository';

const now = new Date('2026-06-17T00:00:00.000Z');

function updatedState(): IpdeConversationState {
  return {
    id: 'state-1',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    stage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
    automationMode: IpdeAutomationMode.PAUSED_HUMAN,
    pauseReason: 'PAYMENT_PROOF_RECEIVED',
    pausedAt: now,
    resumedAt: null,
    stateVersion: 2,
    lastTransitionAt: now,
    activeOrderId: 'order-1',
    createdAt: now,
    updatedAt: now,
  };
}

describe('IpdeConversationStateRepository transition', () => {
  it('pauses automation and increments the optimistic version for payment review', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const prisma = {
      ipdeConversationState: {
        updateMany,
        findFirst: jest.fn(() => Promise.resolve(updatedState())),
      },
    } as unknown as PrismaService;
    const repository = new IpdeConversationStateRepository(prisma);

    const result = await repository.transition({
      id: 'state-1',
      tenantId: 'tenant-1',
      expectedVersion: 1,
      nextStage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
      reason: 'PAYMENT_PROOF_RECEIVED',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'state-1',
        tenantId: 'tenant-1',
        stateVersion: 1,
      },
      data: expect.objectContaining({
        stage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
        automationMode: IpdeAutomationMode.PAUSED_HUMAN,
        pauseReason: 'PAYMENT_PROOF_RECEIVED',
        stateVersion: { increment: 1 },
      }) as Prisma.IpdeConversationStateUpdateManyMutationInput,
    });
    expect(result.stateVersion).toBe(2);
  });

  it('rejects a compare-and-set update when the version is stale', async () => {
    const prisma = {
      ipdeConversationState: {
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService;
    const repository = new IpdeConversationStateRepository(prisma);

    await expect(
      repository.transition({
        id: 'state-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        nextStage: IpdeConversationStage.WAITING_FOR_SUBJECT,
      }),
    ).rejects.toBeInstanceOf(ConcurrentIpdeStateUpdateError);
  });
});
