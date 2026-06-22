import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
} from '@prisma/client';
import {
  ConcurrentIpdeStateUpdateError,
  InvalidIpdeStageTransitionError,
  IpdeConversationOwnershipError,
} from '../domain/ipde-sales.errors';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeConversationStateRepository } from '../repositories/ipde-conversation-state.repository';
import { IpdeConversationStateService } from './ipde-conversation-state.service';

type StateRepositoryMock = {
  getOrCreate: jest.MockedFunction<
    IpdeConversationStateRepository['getOrCreate']
  >;
  findByConversation: jest.MockedFunction<
    IpdeConversationStateRepository['findByConversation']
  >;
  transition: jest.MockedFunction<
    IpdeConversationStateRepository['transition']
  >;
  pauseForHuman: jest.MockedFunction<
    IpdeConversationStateRepository['pauseForHuman']
  >;
  resumeAutomation: jest.MockedFunction<
    IpdeConversationStateRepository['resumeAutomation']
  >;
};

function state(
  overrides: Partial<IpdeConversationState> = {},
): IpdeConversationState {
  const now = new Date('2026-06-17T00:00:00.000Z');
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
    ...overrides,
  };
}

describe('IpdeConversationStateService', () => {
  let repository: StateRepositoryMock;
  let service: IpdeConversationStateService;

  beforeEach(() => {
    repository = {
      getOrCreate: jest.fn(),
      findByConversation: jest.fn(),
      transition: jest.fn(),
      pauseForHuman: jest.fn(),
      resumeAutomation: jest.fn(),
    };
    service = new IpdeConversationStateService(
      repository as unknown as IpdeConversationStateRepository,
      new IpdeStageTransitionPolicy(),
    );
  });

  it('creates a NEW state with active automation', async () => {
    repository.getOrCreate.mockResolvedValue(state());

    const result = await service.getOrCreateState({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
    });

    expect(result.stage).toBe(IpdeConversationStage.NEW);
    expect(result.automationMode).toBe(IpdeAutomationMode.ACTIVE);
  });

  it('returns the same state for repeated idempotent calls', async () => {
    const existing = state();
    repository.getOrCreate.mockResolvedValue(existing);

    const params = {
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
    };
    const [first, second] = await Promise.all([
      service.getOrCreateState(params),
      service.getOrCreateState(params),
    ]);

    expect(first.id).toBe(second.id);
  });

  it('rejects a conversation owned by another tenant', async () => {
    repository.getOrCreate.mockRejectedValue(
      new IpdeConversationOwnershipError(),
    );

    await expect(
      service.getOrCreateState({
        tenantId: 'tenant-2',
        leadId: 'lead-1',
        conversationId: 'conversation-1',
      }),
    ).rejects.toBeInstanceOf(IpdeConversationOwnershipError);
  });

  it('allows a declared transition and increments the version', async () => {
    repository.findByConversation.mockResolvedValue(state());
    repository.transition.mockResolvedValue(
      state({
        stage: IpdeConversationStage.UNDERSTANDING_REQUEST,
        stateVersion: 2,
      }),
    );

    const result = await service.transition({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      expectedVersion: 1,
      nextStage: IpdeConversationStage.UNDERSTANDING_REQUEST,
    });

    expect(result.stateVersion).toBe(2);
    expect(result.stage).toBe(IpdeConversationStage.UNDERSTANDING_REQUEST);
  });

  it.each([
    [
      IpdeConversationStage.NEW,
      IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    ],
    [
      IpdeConversationStage.UNDERSTANDING_REQUEST,
      IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    ],
    [
      IpdeConversationStage.WAITING_FOR_SUBJECT,
      IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    ],
    [
      IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
      IpdeConversationStage.WAITING_FOR_FULL_NAME,
    ],
  ])('allows the controlled Block 5 direct transition %s -> %s', (from, to) => {
    expect(new IpdeStageTransitionPolicy().canTransition(from, to)).toBe(true);
  });

  it('rejects an undeclared transition', async () => {
    repository.findByConversation.mockResolvedValue(state());

    await expect(
      service.transition({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        expectedVersion: 1,
        nextStage: IpdeConversationStage.COMPLETED,
      }),
    ).rejects.toBeInstanceOf(InvalidIpdeStageTransitionError);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('rejects a stale state version instead of overwriting it', async () => {
    repository.findByConversation.mockResolvedValue(state({ stateVersion: 2 }));
    repository.transition.mockRejectedValue(
      new ConcurrentIpdeStateUpdateError(),
    );

    await expect(
      service.transition({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        expectedVersion: 1,
        nextStage: IpdeConversationStage.WAITING_FOR_SUBJECT,
      }),
    ).rejects.toBeInstanceOf(ConcurrentIpdeStateUpdateError);
  });

  it('pauses for human review and keeps PAYMENT_UNDER_REVIEW', async () => {
    const paymentReview = state({
      stage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
      stateVersion: 4,
    });
    repository.findByConversation.mockResolvedValue(paymentReview);
    repository.pauseForHuman.mockResolvedValue(
      state({
        stage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
        automationMode: IpdeAutomationMode.PAUSED_HUMAN,
        pauseReason: 'Comprobante recibido',
        stateVersion: 5,
      }),
    );

    const result = await service.pauseForHuman({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      reason: '  Comprobante   recibido ',
    });

    expect(result.stage).toBe(IpdeConversationStage.PAYMENT_UNDER_REVIEW);
    expect(result.automationMode).toBe(IpdeAutomationMode.PAUSED_HUMAN);
    expect(repository.pauseForHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        preservePaymentReview: true,
        reason: 'Comprobante recibido',
      }),
    );
  });

  it('does not resume payment review automatically', async () => {
    repository.findByConversation.mockResolvedValue(
      state({
        stage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
        automationMode: IpdeAutomationMode.PAUSED_HUMAN,
      }),
    );

    await expect(
      service.resumeAutomation({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
      }),
    ).rejects.toBeInstanceOf(InvalidIpdeStageTransitionError);
    expect(repository.resumeAutomation).not.toHaveBeenCalled();
  });

  it('treats COMPLETED as terminal', async () => {
    repository.findByConversation.mockResolvedValue(
      state({ stage: IpdeConversationStage.COMPLETED }),
    );

    await expect(
      service.pauseForHuman({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        reason: 'No debe aplicarse',
      }),
    ).rejects.toBeInstanceOf(InvalidIpdeStageTransitionError);
  });
});
