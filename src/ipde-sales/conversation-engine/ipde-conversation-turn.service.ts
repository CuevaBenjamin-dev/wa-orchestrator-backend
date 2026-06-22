import { Injectable, Logger } from '@nestjs/common';
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { ConcurrentIpdeStateUpdateError } from '../domain/ipde-sales.errors';
import { IpdeConversationStateService } from '../services/ipde-conversation-state.service';
import { IpdeCatalogResolutionService } from '../catalog-resolution/ipde-catalog-resolution.service';
import { IpdeCatalogResolutionResult } from '../catalog-resolution/ipde-catalog-resolution.types';
import { IpdeMessageUnderstandingService } from '../understanding/ipde-message-understanding.service';
import { IpdeMessageUnderstandingResult } from '../understanding/ipde-understanding.types';
import { IpdeConversationContextService } from './ipde-conversation-context.service';
import { IpdeConversationPlannerService } from './ipde-conversation-planner.service';
import { IpdeResponseCopyService } from './ipde-response-copy.service';
import { IpdeTurnPersistenceService } from './ipde-turn-persistence.service';
import { IpdeConversationTurnConflictError } from './ipde-conversation-turn.errors';
import {
  IpdeAppliedChange,
  IpdeConversationTurnInput,
  IpdeConversationTurnInputSchema,
  IpdeConversationTurnResult,
  IpdeConversationTurnResultSchema,
} from './ipde-conversation-turn.schemas';
import {
  IpdeConversationTurnContext,
  IpdeConversationTurnPlan,
  IpdeTurnPersistenceResult,
} from './ipde-conversation-turn.types';

const MAX_CONCURRENT_RETRIES = 2;

@Injectable()
export class IpdeConversationTurnService {
  private readonly logger = new Logger(IpdeConversationTurnService.name);

  constructor(
    private readonly contexts: IpdeConversationContextService,
    private readonly understanding: IpdeMessageUnderstandingService,
    private readonly catalog: IpdeCatalogResolutionService,
    private readonly planner: IpdeConversationPlannerService,
    private readonly persistence: IpdeTurnPersistenceService,
    private readonly states: IpdeConversationStateService,
    private readonly copy: IpdeResponseCopyService,
  ) {}

  async processTurn(
    candidate: IpdeConversationTurnInput,
  ): Promise<IpdeConversationTurnResult> {
    const input = IpdeConversationTurnInputSchema.parse(candidate);
    const startedAt = Date.now();
    const initialContext = await this.contexts.load(input);
    const pausedReason = this.pausedReason(initialContext.state);
    if (pausedReason) {
      return this.validateResult({
        turnId: input.turnId,
        state: this.stateSummary(initialContext.state, initialContext.state),
        order: this.orderSummary(initialContext, false),
        understanding: null,
        catalogResolution: null,
        appliedChanges: initialContext.stateCreated
          ? [{ type: 'STATE_CREATED', stateId: initialContext.state.id }]
          : [{ type: 'NO_CHANGE' }],
        outboundActions: [
          { type: 'NO_AUTOMATED_RESPONSE', reason: pausedReason },
        ],
        deferredIntents: [],
        metadata: {
          openAiCalls: 0,
          tokensInput: 0,
          tokensOutput: 0,
          latencyMs: Date.now() - startedAt,
          usedFallback: false,
          concurrentRetryCount: 0,
        },
      });
    }

    const understood = await this.understanding.understand(
      this.contexts.buildUnderstandingInput(initialContext),
    );
    if (
      understood.extraction.primaryIntent === 'REQUEST_HUMAN' ||
      understood.extraction.commercialSignals.wantsHuman
    ) {
      return this.handleHumanRequest(initialContext, understood, startedAt);
    }

    const catalogResolution = this.shouldResolveCatalog(understood)
      ? await this.catalog.resolve({
          tenantCode: IPDE_TENANT_CODE,
          extraction: understood.extraction,
          presentedTopicLists: initialContext.presentedLists.map(
            ({ entry }) => ({
              subjectDisplayName: entry.displayName,
              subjectCatalogEntryId: entry.id,
              topics: entry.topics.map((topic, index) => ({
                position: index + 1,
                topicId: topic.id,
                topicName: topic.name,
              })),
            }),
          ),
        })
      : null;

    let context = initialContext;
    let retries = 0;
    let persisted: IpdeTurnPersistenceResult;
    let finalPlan: IpdeConversationTurnPlan;
    while (true) {
      finalPlan = this.planner.plan({
        context,
        extraction: understood.extraction,
        catalogResolution,
      });
      try {
        persisted = await this.persistence.apply(context, finalPlan);
        break;
      } catch (error) {
        if (!(error instanceof ConcurrentIpdeStateUpdateError)) throw error;
        if (retries >= MAX_CONCURRENT_RETRIES) {
          throw new IpdeConversationTurnConflictError();
        }
        retries += 1;
        context = await this.contexts.load(input);
        const newlyPaused = this.pausedReason(context.state);
        if (newlyPaused) {
          return this.validateResult({
            turnId: input.turnId,
            state: this.stateSummary(initialContext.state, context.state),
            order: this.orderSummary(context, false),
            understanding: this.understandingSummary(understood),
            catalogResolution: this.catalogSummary(catalogResolution),
            appliedChanges: [{ type: 'NO_CHANGE' }],
            outboundActions: [
              { type: 'NO_AUTOMATED_RESPONSE', reason: newlyPaused },
            ],
            deferredIntents: finalPlan.deferredIntents,
            metadata: this.metadata(
              understood,
              catalogResolution,
              startedAt,
              retries,
            ),
          });
        }
      }
    }

    const appliedChanges = initialContext.stateCreated
      ? [
          { type: 'STATE_CREATED', stateId: initialContext.state.id } as const,
          ...persisted.appliedChanges.filter(
            (change) => change.type !== 'NO_CHANGE',
          ),
        ]
      : persisted.appliedChanges;
    const finalContext: IpdeConversationTurnContext = {
      ...context,
      state: persisted.state,
      order: persisted.order,
    };
    const result = this.validateResult({
      turnId: input.turnId,
      state: this.stateSummary(initialContext.state, persisted.state),
      order: this.orderSummary(finalContext, persisted.createdOrder),
      understanding: this.understandingSummary(understood),
      catalogResolution: this.catalogSummary(catalogResolution),
      appliedChanges:
        appliedChanges.length > 0 ? appliedChanges : [{ type: 'NO_CHANGE' }],
      outboundActions: finalPlan.outboundActions,
      deferredIntents: finalPlan.deferredIntents,
      metadata: this.metadata(
        understood,
        catalogResolution,
        startedAt,
        retries,
      ),
    });
    this.logCompletion(input, result);
    return result;
  }

  private async handleHumanRequest(
    context: IpdeConversationTurnContext,
    understood: IpdeMessageUnderstandingResult,
    startedAt: number,
  ): Promise<IpdeConversationTurnResult> {
    let after: IpdeConversationState | null = null;
    let retries = 0;
    while (!after) {
      try {
        after = await this.states.pauseForHuman({
          tenantId: context.input.tenantId,
          conversationId: context.input.conversationId,
          reason: 'USER_REQUESTED_HUMAN',
        });
      } catch (error) {
        if (!(error instanceof ConcurrentIpdeStateUpdateError)) throw error;
        if (retries >= MAX_CONCURRENT_RETRIES) {
          throw new IpdeConversationTurnConflictError();
        }
        retries += 1;
      }
    }
    const changes: IpdeAppliedChange[] = [];
    if (context.stateCreated) {
      changes.push({ type: 'STATE_CREATED', stateId: context.state.id });
    }
    changes.push({ type: 'AUTOMATION_PAUSED', stateId: after.id });
    if (context.state.stage !== after.stage) {
      changes.push({
        type: 'STAGE_TRANSITIONED',
        from: context.state.stage,
        to: after.stage,
      });
    }
    return this.validateResult({
      turnId: context.input.turnId,
      state: this.stateSummary(context.state, after),
      order: this.orderSummary(context, false),
      understanding: this.understandingSummary(understood),
      catalogResolution: null,
      appliedChanges: changes,
      outboundActions: [this.copy.requestHuman()],
      deferredIntents: [],
      metadata: this.metadata(understood, null, startedAt, retries),
    });
  }

  private shouldResolveCatalog(
    result: IpdeMessageUnderstandingResult,
  ): boolean {
    return (
      result.extraction.requestPath !== 'UNDETERMINED' ||
      result.extraction.topicSelections.some(
        (selection) => selection.selectedNumbers.length > 0,
      )
    );
  }

  private pausedReason(
    state: IpdeConversationState,
  ): 'PAUSED_HUMAN' | 'AUTOMATION_DISABLED' | 'PAYMENT_UNDER_REVIEW' | null {
    if (state.stage === IpdeConversationStage.PAYMENT_UNDER_REVIEW) {
      return 'PAYMENT_UNDER_REVIEW';
    }
    if (state.automationMode === IpdeAutomationMode.PAUSED_HUMAN) {
      return 'PAUSED_HUMAN';
    }
    if (state.automationMode === IpdeAutomationMode.DISABLED) {
      return 'AUTOMATION_DISABLED';
    }
    return null;
  }

  private stateSummary(
    before: IpdeConversationState,
    after: IpdeConversationState,
  ) {
    return {
      stageBefore: before.stage,
      stageAfter: after.stage,
      automationMode: after.automationMode,
      versionBefore: before.stateVersion,
      versionAfter: after.stateVersion,
    };
  }

  private orderSummary(context: IpdeConversationTurnContext, created: boolean) {
    return {
      orderId: context.order?.id ?? null,
      status: context.order?.status ?? null,
      createdDuringTurn: created,
    };
  }

  private understandingSummary(result: IpdeMessageUnderstandingResult) {
    return {
      primaryIntent: result.extraction.primaryIntent,
      requestPath: result.extraction.requestPath,
      subjectCount: result.extraction.subjects.length,
      topicSelectionCount: result.extraction.topicSelections.length,
      needsClarification: result.extraction.needsClarification,
    };
  }

  private catalogSummary(result: IpdeCatalogResolutionResult | null) {
    return result
      ? {
          route: result.route,
          resolvedSubjectCount: result.subjects.filter(
            (subject) => subject.catalogEntry !== null,
          ).length,
          directTopicCount: result.directTopics.length,
          numericTopicCount: result.resolvedNumericSelections.reduce(
            (count, selection) => count + selection.selectedTopics.length,
            0,
          ),
          generatedNow: result.metadata.generatedNow,
        }
      : null;
  }

  private metadata(
    understood: IpdeMessageUnderstandingResult,
    catalog: IpdeCatalogResolutionResult | null,
    startedAt: number,
    retries: number,
  ) {
    const understandingCalls =
      understood.metadata.source === 'OPENAI' ||
      (understood.metadata.fallbackReason !== undefined &&
        understood.metadata.fallbackReason !== 'API_KEY_MISSING')
        ? 1
        : 0;
    return {
      openAiCalls: understandingCalls + (catalog?.metadata.openAiCalls ?? 0),
      tokensInput:
        understood.metadata.tokensInput + (catalog?.metadata.tokensInput ?? 0),
      tokensOutput:
        understood.metadata.tokensOutput +
        (catalog?.metadata.tokensOutput ?? 0),
      latencyMs: Date.now() - startedAt,
      usedFallback: understood.metadata.usedFallback,
      concurrentRetryCount: retries,
    };
  }

  private validateResult(
    result: IpdeConversationTurnResult,
  ): IpdeConversationTurnResult {
    return IpdeConversationTurnResultSchema.parse(result);
  }

  private logCompletion(
    input: IpdeConversationTurnInput,
    result: IpdeConversationTurnResult,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'ipde_conversation_turn_completed',
        tenantCode: input.tenantCode,
        tenantKey: createHash('sha256')
          .update(input.tenantId)
          .digest('hex')
          .slice(0, 12),
        turnKey: createHash('sha256')
          .update(input.turnId)
          .digest('hex')
          .slice(0, 12),
        stageBefore: result.state.stageBefore,
        stageAfter: result.state.stageAfter,
        actionCount: result.outboundActions.length,
        deferredIntents: result.deferredIntents,
        openAiCalls: result.metadata.openAiCalls,
        latencyMs: result.metadata.latencyMs,
        concurrentRetryCount: result.metadata.concurrentRetryCount,
      }),
    );
  }
}
