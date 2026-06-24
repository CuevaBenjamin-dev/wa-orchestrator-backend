import { ConfigService } from '@nestjs/config';
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderItemStatus,
  IpdeOrderStatus,
  IpdePaymentStatus,
  IpdeSubjectRequestStatus,
} from '@prisma/client';
import { IpdeCommercialConfigService } from '../commercial-config/ipde-commercial-config.service';
import { IpdeIssuerSelectionService } from '../commercial-config/ipde-issuer-selection.service';
import { IpdeModelPdfSelectionService } from '../commercial-config/ipde-model-pdf-selection.service';
import { IpdeDiscountPolicyService } from '../pricing/ipde-discount-policy.service';
import { IpdeOrderPricingProjectionService } from '../pricing/ipde-order-pricing-projection.service';
import { IpdePricingConfigService } from '../pricing/ipde-pricing-config.service';
import { IpdePricingService } from '../pricing/ipde-pricing.service';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeMessageExtractionSchema } from '../understanding/ipde-understanding.schemas';
import { IpdeOutboundActionSchema } from './ipde-conversation-action.schemas';
import { IpdeConversationPlannerService } from './ipde-conversation-planner.service';
import { IpdeNextRequiredFieldPolicy } from './ipde-next-required-field.policy';
import { IpdeResponseCopyService } from './ipde-response-copy.service';
import { IpdeConversationTurnContext } from './ipde-conversation-turn.types';

const now = new Date('2026-06-22T12:00:00.000Z');

function extraction(overrides: Record<string, unknown> = {}) {
  return IpdeMessageExtractionSchema.parse({
    schemaVersion: 1,
    primaryIntent: 'OTHER',
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

function contextWithItem(params: {
  categoryCode: string;
  productTypeCode: string | null;
  issuerCode?: string | null;
  issuerVariantCode?: string | null;
}): IpdeConversationTurnContext {
  const subject = {
    id: 'subject-1',
    tenantId: 'tenant-1',
    orderId: 'order-1',
    categoryCode: params.categoryCode,
    catalogEntryId: null,
    displayName: 'Materia configurada',
    normalizedName: 'materia configurada',
    catalogSource: null,
    status: IpdeSubjectRequestStatus.SELECTION_COMPLETE,
    listPresentedAt: now,
    selectionCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const item = {
    id: 'item-1',
    tenantId: 'tenant-1',
    orderId: 'order-1',
    subjectRequestId: subject.id,
    catalogTopicId: null,
    topicName: 'Tema configurado',
    normalizedTopicName: 'tema configurado',
    productTypeCode: params.productTypeCode,
    issuerCode: params.issuerCode ?? null,
    issuerVariantCode: params.issuerVariantCode ?? null,
    status: IpdeOrderItemStatus.DRAFT,
    confirmedAt: null,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    input: {
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      turnId: 'turn-commercial-1',
      userMessage: 'Continuar',
      recentMessages: [],
    },
    state: {
      id: 'state-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      stage: IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
      automationMode: IpdeAutomationMode.ACTIVE,
      pauseReason: null,
      pausedAt: null,
      resumedAt: null,
      stateVersion: 3,
      lastTransitionAt: now,
      activeOrderId: 'order-1',
      createdAt: now,
      updatedAt: now,
    },
    stateCreated: false,
    order: {
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
      subjectRequests: [subject],
      items: [item],
    },
    presentedLists: [],
  };
}

describe('IpdeConversationPlannerService commercial configuration', () => {
  const commercial = new IpdeCommercialConfigService(new ConfigService());
  const pricingConfig = new IpdePricingConfigService(new ConfigService());
  let planner: IpdeConversationPlannerService;
  let modelPdfs: IpdeModelPdfSelectionService;

  beforeAll(async () => {
    await commercial.onModuleInit();
    await pricingConfig.onModuleInit();
    modelPdfs = new IpdeModelPdfSelectionService(commercial);
    planner = new IpdeConversationPlannerService(
      new IpdeNextRequiredFieldPolicy(),
      new IpdeResponseCopyService(new ConfigService()),
      new IpdeStageTransitionPolicy(),
      commercial,
      new IpdeIssuerSelectionService(commercial),
      modelPdfs,
      new IpdePricingService(pricingConfig, new IpdeDiscountPolicyService()),
      new IpdeOrderPricingProjectionService(),
    );
  });

  it.each([
    ['DERECHO', 'CAC', 'CAC_DECANO'],
    ['EDUCACION', 'UNT', 'UNT_POSGRADO'],
  ])(
    'builds a configured issuer action for %s',
    (category, issuer, variant) => {
      const plan = planner.plan({
        context: contextWithItem({
          categoryCode: category,
          productTypeCode: 'DIPLOMADO',
        }),
        extraction: extraction(),
        catalogResolution: null,
      });
      const action = plan.outboundActions.find(
        (candidate) => candidate.type === 'ASK_ISSUER_VARIANT',
      );
      expect(action).toMatchObject({
        configurationPending: false,
        recommended: { issuerCode: issuer, variantCode: variant },
      });
      expect(IpdeOutboundActionSchema.safeParse(action).success).toBe(true);
      expect(plan.issuerMutations).toEqual([]);
    },
  );

  it.each([
    ['UNT', 'UNT_POSGRADO'],
    ['UNT', 'UNT_DIRECTORAL'],
    ['CAC', 'CAC_DECANO'],
  ] as const)(
    'persists an accepted configured preference %s/%s',
    (issuer, variant) => {
      const plan = planner.plan({
        context: contextWithItem({
          categoryCode: 'DERECHO',
          productTypeCode: 'DIPLOMADO',
        }),
        extraction: extraction({
          primaryIntent: 'PROVIDE_ISSUER_PREFERENCE',
          issuerPreference: {
            issuerCode: issuer,
            variantCode: variant,
            confidence: 0.95,
          },
        }),
        catalogResolution: null,
      });
      expect(plan.issuerMutations).toEqual([
        {
          issuerCode: issuer,
          issuerVariantCode: variant,
          appliesTo: 'ALL',
          correctionExplicit: false,
        },
      ]);
      expect(plan.targetStage).toBe(
        IpdeConversationStage.WAITING_FOR_FULL_NAME,
      );
      expect(plan.outboundActions).toContainEqual(
        expect.objectContaining({ type: 'ASK_FULL_NAME' }),
      );
    },
  );

  it('asks clarification for an ambiguous issuer', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'EDUCACION',
        productTypeCode: 'CURSO',
      }),
      extraction: extraction({
        primaryIntent: 'PROVIDE_ISSUER_PREFERENCE',
        issuerPreference: {
          issuerCode: 'UNT',
          variantCode: 'UNSPECIFIED',
          confidence: 0.7,
        },
      }),
      catalogResolution: null,
    });
    expect(plan.issuerMutations).toEqual([]);
    expect(plan.outboundActions[0]).toMatchObject({
      type: 'ASK_CLARIFICATION',
      reason: 'AMBIGUOUS_ISSUER',
    });
  });

  it('offers model metadata when product and issuer are complete', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'SALUD',
        productTypeCode: 'CURSO_CAPACITACION',
        issuerCode: 'UNT',
        issuerVariantCode: 'UNT_POSGRADO',
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_MODEL_PDF',
        requestedArtifacts: ['MODEL_PDF'],
      }),
      catalogResolution: null,
    });
    const action = plan.outboundActions.find(
      (candidate) => candidate.type === 'OFFER_MODEL_PDF_OPTIONS',
    );
    expect(action).toMatchObject({
      modelPdfAssets: [
        expect.objectContaining({
          id: 'MODEL_UNT_POSGRADO_CURSO',
          productTypeCode: 'CURSO',
        }),
      ],
    });
    expect(IpdeOutboundActionSchema.safeParse(action).success).toBe(true);
    expect(JSON.stringify(action)).not.toMatch(
      /publicUrl|storageKey|whatsappMediaId|fileName/,
    );
    expect(plan.outboundActions).not.toContainEqual(
      expect.objectContaining({
        type: 'DEFERRED_COMMERCIAL_REQUEST',
        intents: ['MODEL_PDF'],
      }),
    );
    expect(plan.deferredIntents).not.toContain('MODEL_PDF');
  });

  it('asks for product before offering models when product is missing', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'DERECHO',
        productTypeCode: null,
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_MODEL_PDF',
        requestedArtifacts: ['MODEL_PDF'],
      }),
      catalogResolution: null,
    });
    expect(plan.outboundActions[0].type).toBe('ASK_PRODUCT_TYPE');
    expect(
      plan.outboundActions.some(
        (action) => action.type === 'OFFER_MODEL_PDF_OPTIONS',
      ),
    ).toBe(false);
  });

  it('defers a complete model request when no active media is configured', () => {
    jest.spyOn(modelPdfs, 'selectForItems').mockReturnValueOnce([]);
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'SALUD',
        productTypeCode: 'DIPLOMADO',
        issuerCode: 'UNT',
        issuerVariantCode: 'UNT_POSGRADO',
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_MODEL_PDF',
        requestedArtifacts: ['MODEL_PDF'],
      }),
      catalogResolution: null,
    });

    expect(plan.outboundActions).toContainEqual({
      type: 'DEFERRED_COMMERCIAL_REQUEST',
      intents: ['MODEL_PDF'],
      reason: 'MEDIA_NOT_CONFIGURED',
    });
    expect(plan.deferredIntents).toContain('MODEL_PDF');
  });

  it('quotes price and prepares a persisted unconfirmed quote', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'DERECHO',
        productTypeCode: 'DIPLOMADO',
        issuerCode: 'CAC',
        issuerVariantCode: 'CAC_DECANO',
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_PRICE',
        commercialSignals: {
          asksForPrice: true,
          asksForDiscount: false,
          appearsReadyToBuy: false,
          wantsHuman: false,
          mentionsPaymentProof: false,
        },
      }),
      catalogResolution: null,
    });

    expect(plan.outboundActions[0]).toMatchObject({
      type: 'QUOTE_PRICE',
      currencyCode: 'PEN',
      totalPromotionalAmount: '80.00',
    });
    expect(JSON.stringify(plan.outboundActions[0])).not.toMatch(
      /minimumAuthorizedAmount/,
    );
    expect(plan.quoteMutation).toEqual({
      amount: '80.00',
      currencyCode: 'PEN',
      confirmed: false,
      correctionExplicit: false,
    });
    expect(plan.deferredIntents).not.toContain('PRICE');
    expect(plan.targetStage).not.toBe(
      IpdeConversationStage.WAITING_FOR_PAYMENT,
    );
  });

  it('quotes discount without exposing the minimum authorized amount', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'DERECHO',
        productTypeCode: 'DIPLOMADO',
        issuerCode: 'CAC',
        issuerVariantCode: 'CAC_DECANO',
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_DISCOUNT',
        commercialSignals: {
          asksForPrice: false,
          asksForDiscount: true,
          appearsReadyToBuy: false,
          wantsHuman: false,
          mentionsPaymentProof: false,
        },
      }),
      catalogResolution: null,
    });

    expect(plan.outboundActions[0]).toMatchObject({
      type: 'QUOTE_DISCOUNT',
      currentAmount: '80.00',
      discountedAmount: '70.00',
      discountAvailable: true,
    });
    expect(JSON.stringify(plan.outboundActions[0])).not.toMatch(
      /minimumAuthorizedAmount/,
    );
    expect(plan.quoteMutation?.amount).toBe('70.00');
    expect(plan.deferredIntents).not.toContain('DISCOUNT');
  });

  it('reports price unavailable when no pricing rule exists', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'DERECHO',
        productTypeCode: 'CURSO',
        issuerCode: 'CAC',
        issuerVariantCode: 'CAC_DECANO',
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_PRICE',
        commercialSignals: {
          asksForPrice: true,
          asksForDiscount: false,
          appearsReadyToBuy: false,
          wantsHuman: false,
          mentionsPaymentProof: false,
        },
      }),
      catalogResolution: null,
    });

    expect(plan.outboundActions).toContainEqual(
      expect.objectContaining({
        type: 'PRICE_NOT_AVAILABLE',
        reason: 'NO_PRICING_RULE',
      }),
    );
    expect(plan.quoteMutation).toBeNull();
  });

  it('keeps payment methods deferred with the specific payment reason', () => {
    const plan = planner.plan({
      context: contextWithItem({
        categoryCode: 'DERECHO',
        productTypeCode: 'DIPLOMADO',
        issuerCode: 'CAC',
        issuerVariantCode: 'CAC_DECANO',
      }),
      extraction: extraction({
        primaryIntent: 'REQUEST_PAYMENT_METHODS',
        requestedArtifacts: ['PAYMENT_METHODS_IMAGE'],
      }),
      catalogResolution: null,
    });

    expect(plan.outboundActions).toContainEqual({
      type: 'DEFERRED_COMMERCIAL_REQUEST',
      intents: ['PAYMENT_METHODS'],
      reason: 'PAYMENT_METHODS_NOT_CONFIGURED',
    });
    expect(plan.deferredIntents).toContain('PAYMENT_METHODS');
  });
});
