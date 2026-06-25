import { Injectable } from '@nestjs/common';
import {
  IpdeConversationStage,
  IpdeOrderItemStatus,
  IpdeSubjectRequestStatus,
} from '@prisma/client';
import {
  ProductType,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import { IpdeCommercialConfigService } from '../commercial-config/ipde-commercial-config.service';
import {
  IpdeCommercialConfigError,
  IpdeCommercialSelectionError,
} from '../commercial-config/ipde-commercial-config.errors';
import { IpdeIssuerSelectionService } from '../commercial-config/ipde-issuer-selection.service';
import { IpdeModelPdfSelectionService } from '../commercial-config/ipde-model-pdf-selection.service';
import { IpdeMediaAssetsService } from '../media/ipde-media-assets.service';
import { IpdeOrderPricingProjectionService } from '../pricing/ipde-order-pricing-projection.service';
import {
  IpdePricingConfigError,
  IpdePricingSelectionError,
} from '../pricing/ipde-pricing.errors';
import { IpdePricingService } from '../pricing/ipde-pricing.service';
import { IpdeQuoteOrderResult } from '../pricing/ipde-pricing.types';
import {
  IpdeDeferredIntent,
  IpdeOutboundAction,
} from './ipde-conversation-action.schemas';
import { IpdeNextRequiredFieldPolicy } from './ipde-next-required-field.policy';
import { IpdeResponseCopyService } from './ipde-response-copy.service';
import {
  IpdeConversationTurnPlan,
  IpdeItemMutation,
  IpdeQuoteMutation,
  IpdeTurnPlanningInput,
} from './ipde-conversation-turn.types';

type ProjectedItem = {
  itemId: string;
  topicName: string;
  normalizedTopicName: string;
  subjectNormalizedName?: string;
  categoryCode: string | null;
  productTypeCode: string | null;
  issuerCode: string | null;
  issuerVariantCode: string | null;
};

@Injectable()
export class IpdeConversationPlannerService {
  constructor(
    private readonly nextField: IpdeNextRequiredFieldPolicy,
    private readonly copy: IpdeResponseCopyService,
    private readonly transitions: IpdeStageTransitionPolicy,
    private readonly commercial: IpdeCommercialConfigService,
    private readonly issuerSelection: IpdeIssuerSelectionService,
    private readonly modelPdfs: IpdeModelPdfSelectionService,
    private readonly mediaAssets: IpdeMediaAssetsService,
    private readonly pricing: IpdePricingService,
    private readonly pricingProjection: IpdeOrderPricingProjectionService,
  ) {}

  isCommerciallyRelevant(extraction: IpdeMessageExtraction): boolean {
    if (
      extraction.primaryIntent === 'GREETING' &&
      extraction.subjects.length === 0 &&
      extraction.topicSelections.length === 0
    ) {
      return false;
    }
    if (
      extraction.primaryIntent === 'REQUEST_HUMAN' ||
      extraction.commercialSignals.wantsHuman
    ) {
      return false;
    }
    return (
      extraction.subjects.length > 0 ||
      extraction.topicSelections.length > 0 ||
      extraction.productSelections.length > 0 ||
      extraction.issuerPreference.confidence > 0 ||
      extraction.fullNameCandidate !== null ||
      extraction.requestPath === 'CATALOG_LIST' ||
      extraction.commercialSignals.appearsReadyToBuy ||
      extraction.commercialSignals.asksForPrice ||
      extraction.commercialSignals.asksForDiscount ||
      extraction.primaryIntent === 'REQUEST_PRICE' ||
      extraction.primaryIntent === 'REQUEST_DISCOUNT' ||
      extraction.primaryIntent === 'REQUEST_PROMOTION' ||
      extraction.primaryIntent === 'REQUEST_PAYMENT_METHODS'
    );
  }

  plan(input: IpdeTurnPlanningInput): IpdeConversationTurnPlan {
    const { context, extraction, catalogResolution } = input;
    const commercial = this.isCommerciallyRelevant(extraction);
    const ensureOrder = commercial || context.order !== null;
    const deferredIntents = this.deferredIntents(extraction);
    let critical = this.criticalClarification(extraction, catalogResolution);
    const resolvedEntries =
      catalogResolution?.subjects.flatMap((subject) =>
        subject.catalogEntry ? [subject.catalogEntry] : [],
      ) ?? [];
    const shouldPresentLists =
      !critical &&
      catalogResolution?.route === 'CATALOG_LISTS_READY' &&
      resolvedEntries.length > 0;

    const subjectMutations = this.subjectMutations(
      extraction,
      resolvedEntries,
      shouldPresentLists,
    );
    const itemMutations = this.itemMutations(catalogResolution);
    const completedSubjectNames = Array.from(
      new Set(
        itemMutations.flatMap((item) =>
          item.subjectNormalizedName ? [item.subjectNormalizedName] : [],
        ),
      ),
    );
    const correctionExplicit =
      extraction.primaryIntent === 'CORRECT_OR_REJECT' ||
      extraction.confirmation === 'REJECTS_OR_CORRECTS';
    const productMutations = extraction.productSelections.map((selection) => ({
      productTypeCode: selection.productTypeCode,
      appliesTo: selection.appliesTo,
      targetReference: selection.targetReference ?? undefined,
      correctionExplicit,
    }));
    if (!critical) {
      critical = this.productClarification(
        input,
        subjectMutations,
        itemMutations,
        productMutations,
      );
    }
    const preIssuerItems = this.buildProjectedItems(
      input,
      subjectMutations,
      itemMutations,
      productMutations,
      [],
    );
    const issuerResolution = !critical
      ? this.issuerSelection.resolve({
          tenantCode: 'IPDE',
          preference: extraction.issuerPreference,
          itemContexts: preIssuerItems.map((item) => ({
            categoryCode: item.categoryCode,
            productTypeCode: item.productTypeCode,
          })),
        })
      : { kind: 'NONE' as const };
    if (issuerResolution.kind === 'CLARIFICATION') {
      critical = {
        reason: issuerResolution.reason,
        candidates: issuerResolution.candidates,
      };
    }
    const issuerMutations =
      issuerResolution.kind === 'VALID'
        ? [
            {
              issuerCode: issuerResolution.issuerCode,
              issuerVariantCode: issuerResolution.issuerVariantCode,
              appliesTo: 'ALL' as const,
              correctionExplicit,
            },
          ]
        : [];
    const nameMutation = extraction.fullNameCandidate
      ? {
          value: extraction.fullNameCandidate,
          confirmExisting: false,
          correctionExplicit,
        }
      : context.order?.fullName &&
          !context.order.fullNameConfirmedAt &&
          extraction.confirmation === 'CONFIRMS'
        ? {
            confirmExisting: true,
            correctionExplicit: false,
          }
        : null;

    const projectedItems = this.buildProjectedItems(
      input,
      subjectMutations,
      itemMutations,
      productMutations,
      issuerMutations,
    );
    const projected = this.project(
      input,
      projectedItems,
      nameMutation,
      completedSubjectNames,
      shouldPresentLists,
      critical !== null,
    );
    const next = this.nextField.getNext(projected);
    const actions: IpdeOutboundAction[] = [];

    if (critical) {
      actions.push(
        this.copy.clarification(critical.reason, critical.candidates),
      );
    } else if (shouldPresentLists) {
      actions.push(
        ...resolvedEntries.map((entry) => this.copy.presentTopicList(entry)),
      );
    } else if (!ensureOrder && extraction.primaryIntent === 'GREETING') {
      actions.push(this.copy.askSubjectOrDirectTopics());
    } else {
      const newTopicNames = itemMutations.map((item) => item.topicName);
      if (newTopicNames.length > 0)
        actions.push(this.copy.confirmTopics(newTopicNames));
      actions.push(
        this.actionForNext(
          next,
          context,
          resolvedEntries,
          itemMutations,
          projectedItems,
          nameMutation?.value,
        ),
      );
    }

    const pricingResolution = this.resolvePricingActions({
      actions,
      deferredIntents,
      projectedItems,
      correctionExplicit,
    });
    const mediaResolution = this.resolveMediaActions({
      actions,
      deferredIntents,
      projectedItems,
      subjectMutations,
      resolvedEntries,
    });

    const modelRequested = deferredIntents.includes('MODEL_PDF');
    let modelOffered = false;
    const canResolveModels =
      modelRequested &&
      !critical &&
      !shouldPresentLists &&
      ![
        'SUBJECT',
        'TOPIC_SELECTION',
        'PRODUCT_TYPE',
        'ISSUER_VARIANT',
      ].includes(next);
    if (canResolveModels) {
      const assets = this.modelPdfs.selectForItems({
        tenantCode: 'IPDE',
        items: projectedItems,
      });
      if (assets.length > 0) {
        actions.unshift(this.copy.offerModelPdfOptions(assets));
        modelOffered = true;
      } else {
        actions.push({
          type: 'DEFERRED_COMMERCIAL_REQUEST',
          intents: ['MODEL_PDF'],
          reason: 'MEDIA_NOT_CONFIGURED',
        });
      }
    }

    const unresolvedDeferredIntents = deferredIntents.filter(
      (intent) =>
        !pricingResolution.handledIntents.has(intent) &&
        !mediaResolution.handledIntents.has(intent) &&
        !(modelOffered && intent === 'MODEL_PDF'),
    );
    const paymentMethodDeferred = unresolvedDeferredIntents.filter(
      (intent) => intent === 'PAYMENT_METHODS',
    );
    if (paymentMethodDeferred.length > 0) {
      actions.push({
        type: 'DEFERRED_COMMERCIAL_REQUEST',
        intents: paymentMethodDeferred,
        reason: 'PAYMENT_METHODS_NOT_CONFIGURED',
      });
    }
    const genericDeferred = unresolvedDeferredIntents.filter(
      (intent) => intent !== 'MODEL_PDF' && intent !== 'PAYMENT_METHODS',
    );
    if (genericDeferred.length > 0) {
      actions.push({
        type: 'DEFERRED_COMMERCIAL_REQUEST',
        intents: genericDeferred,
        reason: 'OUT_OF_SCOPE_FOR_BLOCK_5',
      });
    }

    const desiredStage = shouldPresentLists
      ? IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION
      : !ensureOrder && extraction.primaryIntent === 'GREETING'
        ? IpdeConversationStage.UNDERSTANDING_REQUEST
        : this.stageFor(next);

    return {
      ensureOrder,
      subjectMutations,
      itemMutations,
      completedSubjectNames,
      productMutations,
      issuerMutations,
      nameMutation,
      quoteMutation: pricingResolution.quoteMutation,
      targetStage: this.safeTargetStage(context.state.stage, desiredStage),
      outboundActions: actions,
      deferredIntents: unresolvedDeferredIntents,
    };
  }

  private subjectMutations(
    extraction: IpdeMessageExtraction,
    entries: SubjectCatalogEntry[],
    markListPresented: boolean,
  ) {
    const catalogByName = new Map(
      entries.map((entry) => [entry.normalizedName, entry]),
    );
    return extraction.subjects.map((subject) => {
      const entry = catalogByName.get(subject.normalizedNameCandidate);
      return {
        displayName: entry?.displayName ?? subject.displayNameCandidate,
        normalizedName:
          entry?.normalizedName ?? subject.normalizedNameCandidate,
        categoryCode: entry?.category ?? subject.categoryCandidate ?? undefined,
        catalogEntryId: entry?.id,
        catalogSource: entry?.source,
        markListPresented: markListPresented && Boolean(entry),
      };
    });
  }

  private itemMutations(
    resolution: IpdeTurnPlanningInput['catalogResolution'],
  ): IpdeItemMutation[] {
    if (!resolution) return [];
    const direct = resolution.directTopics.map((topic) => ({
      topicName: topic.topicName,
      normalizedTopicName: topic.normalizedTopicName,
      subjectNormalizedName: topic.subjectReference
        ? normalizeCatalogText(topic.subjectReference)
        : undefined,
    }));
    const numeric = resolution.resolvedNumericSelections.flatMap((selection) =>
      selection.selectedTopics.map((topic) => ({
        topicName: topic.topicName,
        normalizedTopicName: normalizeCatalogText(topic.topicName),
        subjectNormalizedName: normalizeCatalogText(
          selection.subjectDisplayName,
        ),
        catalogTopicId: topic.topicId ?? undefined,
      })),
    );
    const unique = new Map<string, IpdeItemMutation>();
    for (const item of [...direct, ...numeric]) {
      if (!unique.has(item.normalizedTopicName))
        unique.set(item.normalizedTopicName, item);
    }
    return [...unique.values()];
  }

  private buildProjectedItems(
    input: IpdeTurnPlanningInput,
    subjectMutations: IpdeConversationTurnPlan['subjectMutations'],
    newItems: IpdeItemMutation[],
    productMutations: IpdeConversationTurnPlan['productMutations'],
    issuerMutations: IpdeConversationTurnPlan['issuerMutations'],
  ): ProjectedItem[] {
    const order = input.context.order;
    const subjectById = new Map(
      order?.subjectRequests.map((subject) => [subject.id, subject]) ?? [],
    );
    const categoryByName = new Map(
      subjectMutations.map((subject) => [
        subject.normalizedName,
        subject.categoryCode ?? null,
      ]),
    );
    const existingItems =
      order?.items
        .filter((item) => item.status !== IpdeOrderItemStatus.REMOVED)
        .map((item) => ({
          itemId: item.id,
          topicName: item.topicName,
          normalizedTopicName: item.normalizedTopicName,
          subjectNormalizedName: item.subjectRequestId
            ? subjectById.get(item.subjectRequestId)?.normalizedName
            : undefined,
          categoryCode: item.subjectRequestId
            ? (subjectById.get(item.subjectRequestId)?.categoryCode ?? null)
            : null,
          productTypeCode: item.productTypeCode,
          issuerCode: item.issuerCode,
          issuerVariantCode: item.issuerVariantCode,
        })) ?? [];
    const items = new Map(
      existingItems.map((item) => [item.normalizedTopicName, item]),
    );
    for (const item of newItems) {
      if (!items.has(item.normalizedTopicName)) {
        items.set(item.normalizedTopicName, {
          ...item,
          itemId: item.normalizedTopicName,
          subjectNormalizedName: item.subjectNormalizedName,
          categoryCode: item.subjectNormalizedName
            ? (categoryByName.get(item.subjectNormalizedName) ??
              order?.subjectRequests.find(
                (subject) =>
                  subject.normalizedName === item.subjectNormalizedName,
              )?.categoryCode ??
              null)
            : null,
          productTypeCode: null,
          issuerCode: null,
          issuerVariantCode: null,
        });
      }
    }
    for (const product of productMutations) {
      for (const item of items.values()) {
        if (
          product.appliesTo === 'ALL' ||
          (product.appliesTo === 'TOPIC' &&
            product.targetReference &&
            normalizeCatalogText(product.targetReference) ===
              item.normalizedTopicName) ||
          (product.appliesTo === 'SUBJECT' &&
            product.targetReference &&
            normalizeCatalogText(product.targetReference) ===
              item.subjectNormalizedName)
        ) {
          if (item.productTypeCode && !product.correctionExplicit) continue;
          item.productTypeCode = product.productTypeCode;
        }
      }
    }
    for (const issuer of issuerMutations) {
      for (const item of items.values()) {
        if (
          issuer.appliesTo === 'ALL' ||
          (issuer.appliesTo === 'TOPIC' &&
            issuer.targetReference &&
            normalizeCatalogText(issuer.targetReference) ===
              item.normalizedTopicName) ||
          (issuer.appliesTo === 'SUBJECT' &&
            issuer.targetReference &&
            normalizeCatalogText(issuer.targetReference) ===
              item.subjectNormalizedName)
        ) {
          if (
            (item.issuerCode || item.issuerVariantCode) &&
            !issuer.correctionExplicit
          ) {
            continue;
          }
          item.issuerCode = issuer.issuerCode;
          item.issuerVariantCode = issuer.issuerVariantCode;
        }
      }
    }
    return [...items.values()];
  }

  private project(
    input: IpdeTurnPlanningInput,
    values: ProjectedItem[],
    nameMutation: IpdeConversationTurnPlan['nameMutation'],
    completedSubjectNames: string[],
    presentsList: boolean,
    hasCriticalClarification: boolean,
  ) {
    const order = input.context.order;
    const hasPendingTopicList =
      presentsList ||
      Boolean(
        order?.subjectRequests.some(
          (subject) =>
            subject.status === IpdeSubjectRequestStatus.LIST_PRESENTED &&
            !completedSubjectNames.includes(subject.normalizedName),
        ),
      );
    const fullName = nameMutation?.value ?? order?.fullName ?? null;
    const confirmsName = nameMutation?.confirmExisting === true;
    const changesName = Boolean(
      nameMutation?.value &&
      normalizeCatalogText(nameMutation.value) !==
        normalizeCatalogText(order?.fullName ?? ''),
    );
    return {
      hasCriticalClarification,
      hasSubjectOrTopics:
        input.extraction.subjects.length > 0 ||
        Boolean(order?.subjectRequests.length) ||
        values.length > 0,
      hasPendingTopicList,
      hasSelectedTopics: values.length > 0,
      allTopicsHaveProduct:
        values.length > 0 &&
        values.every((item) => item.productTypeCode !== null),
      allTopicsHaveIssuer:
        values.length > 0 &&
        values.every(
          (item) => item.issuerCode !== null && item.issuerVariantCode !== null,
        ),
      hasFullName: fullName !== null,
      fullNameConfirmed:
        confirmsName || (!changesName && Boolean(order?.fullNameConfirmedAt)),
    };
  }

  private actionForNext(
    next: ReturnType<IpdeNextRequiredFieldPolicy['getNext']>,
    context: IpdeTurnPlanningInput['context'],
    entries: SubjectCatalogEntry[],
    newItems: IpdeItemMutation[],
    projectedItems: ProjectedItem[],
    pendingName?: string,
  ): IpdeOutboundAction {
    const activeTopicNames = [
      ...(context.order?.items
        .filter((item) => item.status !== IpdeOrderItemStatus.REMOVED)
        .map((item) => item.topicName) ?? []),
      ...newItems.map((item) => item.topicName),
    ].filter((value, index, all) => all.indexOf(value) === index);
    const subjectNames = [
      ...(context.order?.subjectRequests.map(
        (subject) => subject.displayName,
      ) ?? []),
      ...entries.map((entry) => entry.displayName),
    ].filter((value, index, all) => all.indexOf(value) === index);

    switch (next) {
      case 'CRITICAL_CLARIFICATION':
        return this.copy.clarification('INSUFFICIENT_INFORMATION', []);
      case 'SUBJECT':
        return this.copy.askSubject();
      case 'TOPIC_SELECTION':
        return this.copy.askTopicSelection(
          subjectNames.length > 0 ? subjectNames : ['materia indicada'],
        );
      case 'PRODUCT_TYPE':
        return this.copy.askProductType(
          this.allowedProducts(context, entries),
          activeTopicNames,
        );
      case 'ISSUER_VARIANT': {
        const categoryCode =
          projectedItems.find((item) => item.categoryCode)?.categoryCode ??
          entries[0]?.category ??
          context.order?.subjectRequests[0]?.categoryCode ??
          null;
        const productTypeCode =
          projectedItems.find((item) => item.productTypeCode)
            ?.productTypeCode ?? null;
        try {
          const recommended = this.commercial.getRecommendedIssuerVariant({
            tenantCode: 'IPDE',
            categoryCode,
            productTypeCode,
          });
          const options = this.commercial.getIssuerOptions({
            tenantCode: 'IPDE',
            categoryCode,
            productTypeCode,
          });
          return this.copy.askIssuerVariant({
            categoryCode,
            recommended,
            options,
          });
        } catch (error) {
          if (error instanceof IpdeCommercialConfigError) {
            return this.copy.askIssuerVariant();
          }
          throw error;
        }
      }
      case 'FULL_NAME':
        return this.copy.askFullName();
      case 'FULL_NAME_CONFIRMATION':
        return this.copy.confirmFullName(
          pendingName ?? context.order?.fullName ?? 'nombre registrado',
        );
      case 'ORDER_CONFIRMATION':
        return this.copy.askOrderConfirmation(activeTopicNames);
    }
  }

  private stageFor(next: ReturnType<IpdeNextRequiredFieldPolicy['getNext']>) {
    const stages: Record<typeof next, IpdeConversationStage> = {
      CRITICAL_CLARIFICATION: IpdeConversationStage.WAITING_FOR_SUBJECT,
      SUBJECT: IpdeConversationStage.WAITING_FOR_SUBJECT,
      TOPIC_SELECTION: IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
      PRODUCT_TYPE: IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
      ISSUER_VARIANT: IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
      FULL_NAME: IpdeConversationStage.WAITING_FOR_FULL_NAME,
      FULL_NAME_CONFIRMATION: IpdeConversationStage.WAITING_FOR_FULL_NAME,
      ORDER_CONFIRMATION: IpdeConversationStage.WAITING_FOR_ORDER_CONFIRMATION,
    };
    return stages[next];
  }

  private safeTargetStage(
    current: IpdeConversationStage,
    desired: IpdeConversationStage,
  ): IpdeConversationStage {
    return current === desired ||
      this.transitions.canTransition(current, desired)
      ? desired
      : current;
  }

  private allowedProducts(
    context: IpdeTurnPlanningInput['context'],
    entries: SubjectCatalogEntry[],
  ): ProductType[] {
    const categories = new Set<string | null>([
      ...entries.map((entry) => entry.category),
      ...(context.order?.subjectRequests.map(
        (subject) => subject.categoryCode,
      ) ?? []),
    ]);
    if (categories.size === 0) categories.add(null);
    let values: Set<ProductType> | null = null;
    for (const categoryCode of categories) {
      const products = new Set(
        this.commercial.getAllowedProductTypesForCategory({
          tenantCode: 'IPDE',
          categoryCode,
        }),
      );
      values = values
        ? new Set([...values].filter((product) => products.has(product)))
        : products;
    }
    return values ? [...values] : [];
  }

  private productClarification(
    input: IpdeTurnPlanningInput,
    subjects: IpdeConversationTurnPlan['subjectMutations'],
    itemMutations: IpdeConversationTurnPlan['itemMutations'],
    products: IpdeConversationTurnPlan['productMutations'],
  ): { reason: string; candidates: string[] } | null {
    if (products.length === 0) return null;
    const items = this.buildProjectedItems(
      input,
      subjects,
      itemMutations,
      [],
      [],
    );
    for (const product of products) {
      const target = normalizeCatalogText(product.targetReference ?? '');
      const targetedItems = items.filter(
        (item) =>
          product.appliesTo === 'ALL' ||
          (product.appliesTo === 'SUBJECT' &&
            item.subjectNormalizedName === target) ||
          (product.appliesTo === 'TOPIC' &&
            item.normalizedTopicName === target),
      );
      if (product.appliesTo !== 'ALL' && targetedItems.length === 0) {
        return { reason: 'AMBIGUOUS_PRODUCT_TYPE', candidates: [] };
      }
      const categories = new Set<string | null>(
        targetedItems.map((item) => item.categoryCode),
      );
      if (categories.size === 0) {
        subjects.forEach((subject) =>
          categories.add(subject.categoryCode ?? null),
        );
      }
      if (categories.size === 0) categories.add(null);
      for (const categoryCode of categories) {
        try {
          this.commercial.validateProductSelection({
            tenantCode: 'IPDE',
            categoryCode,
            productTypeCode: product.productTypeCode,
          });
        } catch (error) {
          if (!(error instanceof IpdeCommercialSelectionError)) throw error;
          const allowed = this.commercial.getAllowedProductTypesForCategory({
            tenantCode: 'IPDE',
            categoryCode,
          });
          return { reason: error.code, candidates: allowed };
        }
      }
    }
    return null;
  }

  private criticalClarification(
    extraction: IpdeMessageExtraction,
    resolution: IpdeTurnPlanningInput['catalogResolution'],
  ): { reason: string; candidates: string[] } | null {
    if (resolution?.unresolvedSelections.length) {
      return {
        reason: resolution.unresolvedSelections[0].reason,
        candidates: [],
      };
    }
    const unresolvedSubject = resolution?.subjects.find((subject) =>
      ['AMBIGUOUS', 'FAILED'].includes(subject.resolutionStatus),
    );
    if (unresolvedSubject) {
      return {
        reason: unresolvedSubject.errorCode ?? 'AMBIGUOUS_SUBJECT',
        candidates: unresolvedSubject.clarificationCandidates,
      };
    }
    if (extraction.needsClarification && extraction.ambiguities.length > 0) {
      return {
        reason: extraction.ambiguities[0].code,
        candidates: extraction.ambiguities[0].candidateValues,
      };
    }
    const incompleteProductTarget = extraction.productSelections.find(
      (selection) =>
        selection.appliesTo !== 'ALL' && !selection.targetReference,
    );
    if (incompleteProductTarget) {
      return { reason: 'AMBIGUOUS_PRODUCT_TYPE', candidates: [] };
    }
    return null;
  }

  private deferredIntents(
    extraction: IpdeMessageExtraction,
  ): IpdeDeferredIntent[] {
    const values = new Set<IpdeDeferredIntent>();
    if (
      extraction.commercialSignals.asksForPrice ||
      extraction.primaryIntent === 'REQUEST_PRICE'
    )
      values.add('PRICE');
    if (
      extraction.commercialSignals.asksForDiscount ||
      extraction.primaryIntent === 'REQUEST_DISCOUNT'
    )
      values.add('DISCOUNT');
    if (
      extraction.primaryIntent === 'REQUEST_PROMOTION' ||
      extraction.requestedArtifacts.includes('PROMOTION_IMAGE')
    )
      values.add('PROMOTION');
    if (
      extraction.primaryIntent === 'REQUEST_MODEL_PDF' ||
      extraction.requestedArtifacts.includes('MODEL_PDF')
    )
      values.add('MODEL_PDF');
    if (
      extraction.primaryIntent === 'REQUEST_PAYMENT_METHODS' ||
      extraction.requestedArtifacts.includes('PAYMENT_METHODS_IMAGE')
    )
      values.add('PAYMENT_METHODS');
    if (
      extraction.commercialSignals.mentionsPaymentProof ||
      extraction.primaryIntent === 'PAYMENT_PROOF_MENTION'
    )
      values.add('PAYMENT_PROOF_MENTION');
    return [...values];
  }

  private resolvePricingActions(params: {
    actions: IpdeOutboundAction[];
    deferredIntents: IpdeDeferredIntent[];
    projectedItems: ProjectedItem[];
    correctionExplicit: boolean;
  }): {
    quoteMutation: IpdeQuoteMutation | null;
    handledIntents: Set<IpdeDeferredIntent>;
  } {
    const handledIntents = new Set<IpdeDeferredIntent>();
    const wantsPrice = params.deferredIntents.includes('PRICE');
    const wantsPromotion = params.deferredIntents.includes('PROMOTION');
    const wantsDiscount = params.deferredIntents.includes('DISCOUNT');
    if (!wantsPrice && !wantsPromotion && !wantsDiscount) {
      return { quoteMutation: null, handledIntents };
    }

    for (const intent of ['PRICE', 'PROMOTION', 'DISCOUNT'] as const) {
      if (params.deferredIntents.includes(intent)) handledIntents.add(intent);
    }

    const quote = this.tryQuoteProjectedItems(params.projectedItems);
    if (quote.kind === 'WAITING_FOR_DATA') {
      return { quoteMutation: null, handledIntents };
    }
    if (quote.kind === 'NOT_AVAILABLE') {
      params.actions.push(this.copy.priceNotAvailable(quote.reason));
      return { quoteMutation: null, handledIntents };
    }

    if (wantsDiscount) {
      const discount = this.pricing.quoteDiscount({
        tenantCode: 'IPDE',
        categoryCode: null,
        items: this.pricingProjection.fromProjectedItems(params.projectedItems),
      });
      params.actions.unshift(this.copy.quoteDiscount(discount));
      return {
        quoteMutation: discount.discountAvailable
          ? {
              amount: discount.discountedAmount,
              currencyCode: discount.currencyCode,
              confirmed: false,
              correctionExplicit: params.correctionExplicit,
            }
          : null,
        handledIntents,
      };
    }

    params.actions.unshift(this.copy.quotePrice(quote.quote));
    return {
      quoteMutation: {
        amount: quote.quote.totalPromotionalAmount,
        currencyCode: quote.quote.currencyCode,
        confirmed: false,
        correctionExplicit: params.correctionExplicit,
      },
      handledIntents,
    };
  }

  private resolveMediaActions(params: {
    actions: IpdeOutboundAction[];
    deferredIntents: IpdeDeferredIntent[];
    projectedItems: ProjectedItem[];
    subjectMutations: IpdeConversationTurnPlan['subjectMutations'];
    resolvedEntries: SubjectCatalogEntry[];
  }): { handledIntents: Set<IpdeDeferredIntent> } {
    const handledIntents = new Set<IpdeDeferredIntent>();

    if (params.deferredIntents.includes('PROMOTION')) {
      const categoryCode = this.dominantCategory({
        projectedItems: params.projectedItems,
        subjectMutations: params.subjectMutations,
        resolvedEntries: params.resolvedEntries,
      });
      const asset = this.mediaAssets.getPromotionImageForCategory({
        tenantCode: 'IPDE',
        categoryCode,
      });
      if (asset) {
        params.actions.push(
          this.copy.sendPromotionImage({
            assetId: asset.id,
            categoryCode,
          }),
        );
      } else {
        params.actions.push({
          type: 'DEFERRED_COMMERCIAL_REQUEST',
          intents: ['PROMOTION'],
          reason: 'MEDIA_NOT_CONFIGURED',
        });
      }
      handledIntents.add('PROMOTION');
    }

    if (params.deferredIntents.includes('PAYMENT_METHODS')) {
      const asset = this.mediaAssets.getPaymentMethodsImage({
        tenantCode: 'IPDE',
      });
      if (asset) {
        params.actions.push(this.copy.sendPaymentMethodsImage(asset.id));
      } else {
        params.actions.push({
          type: 'DEFERRED_COMMERCIAL_REQUEST',
          intents: ['PAYMENT_METHODS'],
          reason: 'PAYMENT_METHODS_NOT_CONFIGURED',
        });
      }
      handledIntents.add('PAYMENT_METHODS');
    }

    return { handledIntents };
  }

  private dominantCategory(params: {
    projectedItems: ProjectedItem[];
    subjectMutations: IpdeConversationTurnPlan['subjectMutations'];
    resolvedEntries: SubjectCatalogEntry[];
  }): string | null {
    const counts = new Map<string, number>();
    for (const value of [
      ...params.projectedItems.map((item) => item.categoryCode),
      ...params.subjectMutations.map((subject) => subject.categoryCode ?? null),
      ...params.resolvedEntries.map((entry) => entry.category),
    ]) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort(
      (left, right) => right[1] - left[1],
    );
    return sorted[0]?.[0] ?? null;
  }

  private tryQuoteProjectedItems(projectedItems: ProjectedItem[]):
    | { kind: 'QUOTED'; quote: IpdeQuoteOrderResult }
    | {
        kind: 'NOT_AVAILABLE';
        reason: 'NO_PRICING_RULE' | 'PARTIAL_PRICING';
      }
    | { kind: 'WAITING_FOR_DATA' } {
    if (projectedItems.length === 0) return { kind: 'WAITING_FOR_DATA' };
    if (projectedItems.some((item) => !item.productTypeCode)) {
      return { kind: 'WAITING_FOR_DATA' };
    }
    if (
      projectedItems.some((item) => !item.issuerCode || !item.issuerVariantCode)
    ) {
      return { kind: 'WAITING_FOR_DATA' };
    }
    try {
      const quote = this.pricing.quoteOrder({
        tenantCode: 'IPDE',
        categoryCode: null,
        items: this.pricingProjection.fromProjectedItems(projectedItems),
      });
      if (quote.quoteStatus === 'QUOTED') {
        return { kind: 'QUOTED', quote };
      }
      return {
        kind: 'NOT_AVAILABLE',
        reason:
          quote.quoteStatus === 'PARTIAL'
            ? 'PARTIAL_PRICING'
            : 'NO_PRICING_RULE',
      };
    } catch (error) {
      if (error instanceof IpdePricingSelectionError) {
        return { kind: 'WAITING_FOR_DATA' };
      }
      if (error instanceof IpdePricingConfigError) throw error;
      throw error;
    }
  }
}
