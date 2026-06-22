import { Injectable } from '@nestjs/common';
import {
  IpdeConversationStage,
  IpdeOrderItemStatus,
  IpdeSubjectRequestStatus,
} from '@prisma/client';
import {
  PRODUCT_TYPES,
  ProductType,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import {
  IpdeDeferredIntent,
  IpdeOutboundAction,
} from './ipde-conversation-action.schemas';
import { IpdeNextRequiredFieldPolicy } from './ipde-next-required-field.policy';
import { IpdeResponseCopyService } from './ipde-response-copy.service';
import {
  IpdeConversationTurnPlan,
  IpdeItemMutation,
  IpdeTurnPlanningInput,
} from './ipde-conversation-turn.types';

@Injectable()
export class IpdeConversationPlannerService {
  constructor(
    private readonly nextField: IpdeNextRequiredFieldPolicy,
    private readonly copy: IpdeResponseCopyService,
    private readonly transitions: IpdeStageTransitionPolicy,
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
      extraction.fullNameCandidate !== null ||
      extraction.requestPath === 'CATALOG_LIST' ||
      extraction.commercialSignals.appearsReadyToBuy
    );
  }

  plan(input: IpdeTurnPlanningInput): IpdeConversationTurnPlan {
    const { context, extraction, catalogResolution } = input;
    const commercial = this.isCommerciallyRelevant(extraction);
    const ensureOrder = commercial || context.order !== null;
    const deferredIntents = this.deferredIntents(extraction);
    const critical = this.criticalClarification(extraction, catalogResolution);
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

    const projected = this.project(
      input,
      itemMutations,
      productMutations,
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
          nameMutation?.value,
        ),
      );
    }

    if (deferredIntents.length > 0) {
      actions.push({
        type: 'DEFERRED_COMMERCIAL_REQUEST',
        intents: deferredIntents,
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
      nameMutation,
      targetStage: this.safeTargetStage(context.state.stage, desiredStage),
      outboundActions: actions,
      deferredIntents,
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

  private project(
    input: IpdeTurnPlanningInput,
    newItems: IpdeItemMutation[],
    productMutations: IpdeConversationTurnPlan['productMutations'],
    nameMutation: IpdeConversationTurnPlan['nameMutation'],
    completedSubjectNames: string[],
    presentsList: boolean,
    hasCriticalClarification: boolean,
  ) {
    const order = input.context.order;
    const subjectById = new Map(
      order?.subjectRequests.map((subject) => [
        subject.id,
        subject.normalizedName,
      ]) ?? [],
    );
    const existingItems =
      order?.items
        .filter((item) => item.status !== IpdeOrderItemStatus.REMOVED)
        .map((item) => ({
          topicName: item.topicName,
          normalizedTopicName: item.normalizedTopicName,
          subjectNormalizedName: item.subjectRequestId
            ? subjectById.get(item.subjectRequestId)
            : undefined,
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
          subjectNormalizedName: item.subjectNormalizedName,
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
          item.productTypeCode = product.productTypeCode;
        }
      }
    }
    const values = [...items.values()];
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
        newItems.length > 0 ||
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
          this.allowedProducts(entries),
          activeTopicNames,
        );
      case 'ISSUER_VARIANT':
        return this.copy.askIssuerVariant();
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

  private allowedProducts(entries: SubjectCatalogEntry[]): ProductType[] {
    const values = new Set(
      entries.flatMap((entry) => entry.allowedProductTypes),
    );
    return values.size > 0 ? [...values] : [...PRODUCT_TYPES];
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
}
