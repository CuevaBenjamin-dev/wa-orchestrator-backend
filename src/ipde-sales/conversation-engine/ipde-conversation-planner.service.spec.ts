import { ConfigService } from '@nestjs/config';
import { IpdeAutomationMode, IpdeConversationStage } from '@prisma/client';
import { SubjectCatalogEntry } from '../../catalog/domain/catalog.types';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeMessageExtractionSchema } from '../understanding/ipde-understanding.schemas';
import { IpdeCatalogResolutionResultSchema } from '../catalog-resolution/ipde-catalog-resolution.schemas';
import { IpdeConversationPlannerService } from './ipde-conversation-planner.service';
import { IpdeNextRequiredFieldPolicy } from './ipde-next-required-field.policy';
import { IpdeResponseCopyService } from './ipde-response-copy.service';
import { IpdeConversationTurnContext } from './ipde-conversation-turn.types';

function extraction(overrides: Record<string, unknown> = {}) {
  return IpdeMessageExtractionSchema.parse({
    schemaVersion: 1,
    primaryIntent: 'GREETING',
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
      wantsHuman: false,
      mentionsPaymentProof: false,
    },
    confirmation: 'UNCLEAR',
    needsClarification: false,
    ambiguities: [],
    overallConfidence: 0.9,
    ...overrides,
  });
}

function context(
  stage = IpdeConversationStage.NEW,
): IpdeConversationTurnContext {
  const now = new Date('2026-06-22T10:00:00.000Z');
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
    },
    stateCreated: false,
    order: null,
    presentedLists: [],
  };
}

function catalogEntry(): SubjectCatalogEntry {
  return {
    schemaVersion: 1,
    id: 'DERECHO_CIVIL',
    tenantCode: 'IPDE',
    category: 'DERECHO',
    displayName: 'Derecho Civil',
    normalizedName: 'derecho civil',
    aliases: [],
    allowedProductTypes: ['DIPLOMADO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `CIVIL_${index + 1}`,
      name: `Tema civil número ${index + 1}`,
      aliases: [],
      active: true,
      priority: index + 1,
    })),
    source: 'MANUAL',
    active: true,
    version: 1,
  };
}

describe('IpdeConversationPlannerService', () => {
  const transitions = new IpdeStageTransitionPolicy();
  const planner = new IpdeConversationPlannerService(
    new IpdeNextRequiredFieldPolicy(),
    new IpdeResponseCopyService(new ConfigService()),
    transitions,
  );

  it('keeps an isolated greeting free of order creation', () => {
    const plan = planner.plan({
      context: context(),
      extraction: extraction(),
      catalogResolution: null,
    });
    expect(plan.ensureOrder).toBe(false);
    expect(plan.targetStage).toBe(IpdeConversationStage.UNDERSTANDING_REQUEST);
    expect(plan.outboundActions).toEqual([
      expect.objectContaining({ type: 'ASK_SUBJECT_OR_DIRECT_TOPICS' }),
    ]);
  });

  it('presents a validated list and jumps directly to topic selection', () => {
    const entry = catalogEntry();
    const understood = extraction({
      primaryIntent: 'REQUEST_SUBJECT_LIST',
      requestPath: 'CATALOG_LIST',
      subjects: [
        {
          rawText: 'derecho civil',
          displayNameCandidate: 'Derecho Civil',
          normalizedNameCandidate: 'derecho civil',
          categoryCandidate: 'DERECHO',
          confidence: 0.98,
          isAcronym: false,
          needsClarification: false,
        },
      ],
    });
    const resolution = IpdeCatalogResolutionResultSchema.parse({
      route: 'CATALOG_LISTS_READY',
      subjects: [
        {
          rawText: 'derecho civil',
          requestedDisplayName: 'Derecho Civil',
          normalizedQuery: 'derecho civil',
          category: 'DERECHO',
          resolutionStatus: 'FOUND_MANUAL',
          catalogEntry: entry,
          matchedBy: 'DISPLAY_NAME',
          clarificationCandidates: [],
          errorCode: null,
        },
      ],
      directTopics: [],
      resolvedNumericSelections: [],
      unresolvedSelections: [],
      metadata: {
        manualMatches: 1,
        generatedMatches: 0,
        generatedNow: 0,
        openAiCalls: 0,
        tokensInput: 0,
        tokensOutput: 0,
        latencyMs: 1,
      },
    });
    const plan = planner.plan({
      context: context(),
      extraction: understood,
      catalogResolution: resolution,
    });
    expect(plan.ensureOrder).toBe(true);
    expect(plan.targetStage).toBe(
      IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    );
    expect(plan.subjectMutations[0].markListPresented).toBe(true);
    expect(plan.outboundActions[0].type).toBe('PRESENT_TOPIC_LIST');
    if (plan.outboundActions[0].type === 'PRESENT_TOPIC_LIST') {
      expect(plan.outboundActions[0].topics).toHaveLength(25);
    }
  });

  it('persists direct topics and requests the product type next', () => {
    const understood = extraction({
      primaryIntent: 'PROVIDE_PRESELECTED_TOPICS',
      requestPath: 'DIRECT_TOPICS',
      topicSelections: [
        {
          rawText: 'responsabilidad civil',
          subjectReference: null,
          selectedNumbers: [],
          selectedNames: ['Responsabilidad civil'],
          confidence: 0.99,
        },
      ],
      commercialSignals: {
        asksForPrice: true,
        asksForDiscount: false,
        appearsReadyToBuy: false,
        wantsHuman: false,
        mentionsPaymentProof: false,
      },
    });
    const resolution = IpdeCatalogResolutionResultSchema.parse({
      route: 'DIRECT_TOPICS',
      subjects: [],
      directTopics: [
        {
          rawText: 'responsabilidad civil',
          topicName: 'Responsabilidad civil',
          normalizedTopicName: 'responsabilidad civil',
          subjectReference: null,
          confidence: 0.99,
        },
      ],
      resolvedNumericSelections: [],
      unresolvedSelections: [],
      metadata: {
        manualMatches: 0,
        generatedMatches: 0,
        generatedNow: 0,
        openAiCalls: 0,
        tokensInput: 0,
        tokensOutput: 0,
        latencyMs: 0,
      },
    });
    const plan = planner.plan({
      context: context(),
      extraction: understood,
      catalogResolution: resolution,
    });
    expect(plan.itemMutations).toHaveLength(1);
    expect(plan.targetStage).toBe(
      IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    );
    expect(plan.outboundActions.map((action) => action.type)).toEqual([
      'CONFIRM_SELECTED_TOPICS',
      'ASK_PRODUCT_TYPE',
      'DEFERRED_COMMERCIAL_REQUEST',
    ]);
    expect(plan.deferredIntents).toEqual(['PRICE']);
  });

  it('does not present a partial list when one resolution needs clarification', () => {
    const understood = extraction({
      primaryIntent: 'REQUEST_SUBJECT_LIST',
      requestPath: 'CATALOG_LIST',
      subjects: [
        {
          rawText: 'civil',
          displayNameCandidate: 'Derecho Civil',
          normalizedNameCandidate: 'derecho civil',
          categoryCandidate: 'DERECHO',
          confidence: 0.5,
          isAcronym: false,
          needsClarification: true,
        },
      ],
    });
    const resolution = IpdeCatalogResolutionResultSchema.parse({
      route: 'NEEDS_CLARIFICATION',
      subjects: [
        {
          rawText: 'civil',
          requestedDisplayName: 'Derecho Civil',
          normalizedQuery: 'derecho civil',
          category: 'DERECHO',
          resolutionStatus: 'AMBIGUOUS',
          catalogEntry: null,
          matchedBy: null,
          clarificationCandidates: ['Derecho Civil', 'Ingeniería Civil'],
          errorCode: 'AMBIGUOUS_SUBJECT',
        },
      ],
      directTopics: [],
      resolvedNumericSelections: [],
      unresolvedSelections: [],
      metadata: {
        manualMatches: 0,
        generatedMatches: 0,
        generatedNow: 0,
        openAiCalls: 0,
        tokensInput: 0,
        tokensOutput: 0,
        latencyMs: 0,
      },
    });
    const plan = planner.plan({
      context: context(),
      extraction: understood,
      catalogResolution: resolution,
    });
    expect(plan.outboundActions[0]).toMatchObject({
      type: 'ASK_CLARIFICATION',
      candidates: ['Derecho Civil', 'Ingeniería Civil'],
    });
    expect(plan.subjectMutations[0].markListPresented).toBe(false);
  });
});
