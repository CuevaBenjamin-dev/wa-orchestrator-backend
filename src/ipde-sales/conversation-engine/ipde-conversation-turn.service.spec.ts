/* eslint-disable @typescript-eslint/unbound-method */
import { ConfigService } from '@nestjs/config';
import { IpdeAutomationMode, IpdeConversationStage } from '@prisma/client';
import { ConcurrentIpdeStateUpdateError } from '../domain/ipde-sales.errors';
import { IpdeCatalogResolutionService } from '../catalog-resolution/ipde-catalog-resolution.service';
import { IpdeConversationStateService } from '../services/ipde-conversation-state.service';
import { IpdeMessageUnderstandingService } from '../understanding/ipde-message-understanding.service';
import { IpdeMessageExtractionSchema } from '../understanding/ipde-understanding.schemas';
import { IpdeConversationContextService } from './ipde-conversation-context.service';
import { IpdeConversationPlannerService } from './ipde-conversation-planner.service';
import { IpdeConversationTurnService } from './ipde-conversation-turn.service';
import { IpdeResponseCopyService } from './ipde-response-copy.service';
import { IpdeTurnPersistenceService } from './ipde-turn-persistence.service';
import {
  IpdeConversationTurnContext,
  IpdeConversationTurnPlan,
} from './ipde-conversation-turn.types';

const now = new Date('2026-06-22T10:00:00.000Z');

function context(
  automationMode = IpdeAutomationMode.ACTIVE,
): IpdeConversationTurnContext {
  return {
    input: {
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      userMessage: 'Hola',
      recentMessages: [],
    },
    state: {
      id: 'state-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      stage: IpdeConversationStage.NEW,
      automationMode,
      pauseReason: null,
      pausedAt: null,
      resumedAt: null,
      stateVersion: 1,
      lastTransitionAt: now,
      activeOrderId: null,
      createdAt: now,
      updatedAt: now,
    },
    stateCreated: false,
    order: null,
    presentedLists: [],
  };
}

function understood(primaryIntent = 'GREETING') {
  return {
    extraction: IpdeMessageExtractionSchema.parse({
      schemaVersion: 1,
      primaryIntent,
      secondaryIntents: [],
      requestPath: 'UNDETERMINED',
      subjects: [],
      topicSelections: [],
      productSelections: [],
      issuerPreference: {
        issuerCode: 'UNSPECIFIED',
        variantCode: 'UNSPECIFIED',
        confidence: 0,
      },
      fullNameCandidate: null,
      requestedArtifacts: [],
      commercialSignals: {
        asksForPrice: false,
        asksForDiscount: false,
        appearsReadyToBuy: false,
        wantsHuman: primaryIntent === 'REQUEST_HUMAN',
        mentionsPaymentProof: false,
      },
      confirmation: 'UNCLEAR',
      needsClarification: false,
      ambiguities: [],
      overallConfidence: 0.9,
    }),
    metadata: {
      source: 'OPENAI' as const,
      model: 'gpt-test',
      promptVersion: 'v1',
      tokensInput: 10,
      tokensOutput: 5,
      latencyMs: 1,
      usedFallback: false,
    },
  };
}

function greetingPlan(): IpdeConversationTurnPlan {
  return {
    ensureOrder: false,
    subjectMutations: [],
    itemMutations: [],
    completedSubjectNames: [],
    productMutations: [],
    nameMutation: null,
    targetStage: IpdeConversationStage.UNDERSTANDING_REQUEST,
    outboundActions: [
      {
        type: 'ASK_SUBJECT_OR_DIRECT_TOPICS',
        messageDraft: '¿Qué materia necesitas?',
      },
    ],
    deferredIntents: [],
  };
}

function createService() {
  const contexts = {
    load: jest.fn(),
    buildUnderstandingInput: jest.fn().mockReturnValue({
      tenantCode: 'IPDE',
      userMessage: 'Hola',
      currentStage: IpdeConversationStage.NEW,
      automationMode: IpdeAutomationMode.ACTIVE,
      recentMessages: [],
    }),
  } as unknown as IpdeConversationContextService;
  const understanding = {
    understand: jest.fn(),
  } as unknown as IpdeMessageUnderstandingService;
  const catalog = {
    resolve: jest.fn(),
  } as unknown as IpdeCatalogResolutionService;
  const planner = {
    plan: jest.fn(),
  } as unknown as IpdeConversationPlannerService;
  const persistence = {
    apply: jest.fn(),
  } as unknown as IpdeTurnPersistenceService;
  const states = {
    pauseForHuman: jest.fn(),
  } as unknown as IpdeConversationStateService;
  const copy = new IpdeResponseCopyService(new ConfigService());
  const service = new IpdeConversationTurnService(
    contexts,
    understanding,
    catalog,
    planner,
    persistence,
    states,
    copy,
  );
  return {
    service,
    contexts,
    understanding,
    catalog,
    planner,
    persistence,
    states,
  };
}

describe('IpdeConversationTurnService', () => {
  it.each([
    [IpdeAutomationMode.PAUSED_HUMAN, 'PAUSED_HUMAN'],
    [IpdeAutomationMode.DISABLED, 'AUTOMATION_DISABLED'],
  ] as const)(
    'stops before OpenAI when automation is %s',
    async (mode, reason) => {
      const deps = createService();
      jest.mocked(deps.contexts.load).mockResolvedValue(context(mode));
      const result = await deps.service.processTurn(context(mode).input);
      expect(deps.understanding.understand).not.toHaveBeenCalled();
      expect(deps.catalog.resolve).not.toHaveBeenCalled();
      expect(deps.persistence.apply).not.toHaveBeenCalled();
      expect(result.outboundActions).toEqual([
        { type: 'NO_AUTOMATED_RESPONSE', reason },
      ]);
      expect(result.metadata.openAiCalls).toBe(0);
    },
  );

  it('calls understanding exactly once and does not create an order for greeting', async () => {
    const deps = createService();
    const initial = context();
    const after = {
      ...initial.state,
      stage: IpdeConversationStage.UNDERSTANDING_REQUEST,
      stateVersion: 2,
    };
    jest.mocked(deps.contexts.load).mockResolvedValue(initial);
    jest.mocked(deps.understanding.understand).mockResolvedValue(understood());
    jest.mocked(deps.planner.plan).mockReturnValue(greetingPlan());
    jest.mocked(deps.persistence.apply).mockResolvedValue({
      state: after,
      order: null,
      createdOrder: false,
      appliedChanges: [
        {
          type: 'STAGE_TRANSITIONED',
          from: IpdeConversationStage.NEW,
          to: IpdeConversationStage.UNDERSTANDING_REQUEST,
        },
      ],
    });
    const result = await deps.service.processTurn(initial.input);
    expect(deps.understanding.understand).toHaveBeenCalledTimes(1);
    expect(deps.catalog.resolve).not.toHaveBeenCalled();
    expect(result.order).toEqual({
      orderId: null,
      status: null,
      createdDuringTurn: false,
    });
    expect(result.state.stageAfter).toBe(
      IpdeConversationStage.UNDERSTANDING_REQUEST,
    );
  });

  it('pauses for a human and never resolves the catalog', async () => {
    const deps = createService();
    const initial = context();
    const paused = {
      ...initial.state,
      stage: IpdeConversationStage.HUMAN_TAKEOVER,
      automationMode: IpdeAutomationMode.PAUSED_HUMAN,
      stateVersion: 2,
      pausedAt: now,
    };
    jest.mocked(deps.contexts.load).mockResolvedValue(initial);
    jest
      .mocked(deps.understanding.understand)
      .mockResolvedValue(understood('REQUEST_HUMAN'));
    jest.mocked(deps.states.pauseForHuman).mockResolvedValue(paused);
    const result = await deps.service.processTurn(initial.input);
    expect(deps.catalog.resolve).not.toHaveBeenCalled();
    expect(deps.persistence.apply).not.toHaveBeenCalled();
    expect(result.outboundActions[0].type).toBe('REQUEST_HUMAN_TAKEOVER');
    expect(result.state.automationMode).toBe(IpdeAutomationMode.PAUSED_HUMAN);
  });

  it('replans after a conflict without repeating OpenAI or catalog work', async () => {
    const deps = createService();
    const initial = context();
    const reloaded = {
      ...context(),
      state: { ...context().state, stateVersion: 2 },
    };
    const after = {
      ...reloaded.state,
      stage: IpdeConversationStage.UNDERSTANDING_REQUEST,
      stateVersion: 3,
    };
    jest
      .mocked(deps.contexts.load)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(reloaded);
    jest.mocked(deps.understanding.understand).mockResolvedValue(understood());
    jest.mocked(deps.planner.plan).mockReturnValue(greetingPlan());
    jest
      .mocked(deps.persistence.apply)
      .mockRejectedValueOnce(new ConcurrentIpdeStateUpdateError())
      .mockResolvedValueOnce({
        state: after,
        order: null,
        createdOrder: false,
        appliedChanges: [
          {
            type: 'STAGE_TRANSITIONED',
            from: IpdeConversationStage.NEW,
            to: IpdeConversationStage.UNDERSTANDING_REQUEST,
          },
        ],
      });
    const result = await deps.service.processTurn(initial.input);
    expect(deps.understanding.understand).toHaveBeenCalledTimes(1);
    expect(deps.catalog.resolve).not.toHaveBeenCalled();
    expect(deps.planner.plan).toHaveBeenCalledTimes(2);
    expect(result.metadata.concurrentRetryCount).toBe(1);
  });
});
