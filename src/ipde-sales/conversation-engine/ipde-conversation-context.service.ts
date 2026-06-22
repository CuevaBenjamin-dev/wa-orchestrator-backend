import { Injectable } from '@nestjs/common';
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderItemStatus,
  IpdeSubjectRequestStatus,
} from '@prisma/client';
import { CatalogService } from '../../catalog/catalog.service';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { IpdeOrderService } from '../services/ipde-order.service';
import { IpdeConversationStateService } from '../services/ipde-conversation-state.service';
import { IpdeMessageUnderstandingInput } from '../understanding/ipde-understanding.types';
import { IpdeConversationTurnInput } from './ipde-conversation-turn.schemas';
import { IpdeConversationTurnContext } from './ipde-conversation-turn.types';

@Injectable()
export class IpdeConversationContextService {
  constructor(
    private readonly states: IpdeConversationStateService,
    private readonly orders: IpdeOrderService,
    private readonly catalog: CatalogService,
  ) {}

  async load(
    input: IpdeConversationTurnInput,
  ): Promise<IpdeConversationTurnContext> {
    const previous = await this.states.getState({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    const state = await this.states.getOrCreateState({
      tenantId: input.tenantId,
      leadId: input.leadId,
      conversationId: input.conversationId,
    });
    const order = await this.orders.getActiveOrderAggregate({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    const mayReadCatalog =
      state.automationMode === IpdeAutomationMode.ACTIVE &&
      state.stage !== IpdeConversationStage.PAYMENT_UNDER_REVIEW;
    const presentedLists =
      order && mayReadCatalog
        ? await Promise.all(
            order.subjectRequests
              .filter(
                (subject) =>
                  subject.status === IpdeSubjectRequestStatus.LIST_PRESENTED &&
                  Boolean(subject.catalogEntryId),
              )
              .slice(-3)
              .map(async (subject) => {
                const entry = await this.catalog.getById({
                  tenantCode: IPDE_TENANT_CODE,
                  id: subject.catalogEntryId!,
                });
                return entry ? { entry, subjectRequestId: subject.id } : null;
              }),
          ).then((lists) => lists.filter((item) => item !== null))
        : [];

    return {
      input,
      state,
      stateCreated: previous === null,
      order,
      presentedLists,
    };
  }

  buildUnderstandingInput(
    context: IpdeConversationTurnContext,
  ): IpdeMessageUnderstandingInput {
    const order = context.order;
    const subjectById = new Map(
      order?.subjectRequests.map((subject) => [subject.id, subject]) ?? [],
    );
    return {
      tenantCode: IPDE_TENANT_CODE,
      userMessage: context.input.userMessage,
      currentStage: context.state.stage,
      automationMode: context.state.automationMode,
      recentMessages: context.input.recentMessages,
      knownOrderContext: order
        ? {
            subjects: order.subjectRequests.map((subject) => ({
              displayName: subject.displayName,
              normalizedName: subject.normalizedName,
            })),
            selectedTopics: order.items
              .filter((item) => item.status !== IpdeOrderItemStatus.REMOVED)
              .map((item) => ({
                topicName: item.topicName,
                subjectDisplayName: item.subjectRequestId
                  ? subjectById.get(item.subjectRequestId)?.displayName
                  : undefined,
                productTypeCode: item.productTypeCode ?? undefined,
              })),
            fullName: order.fullName ?? undefined,
            issuerCode:
              order.items.find((item) => item.issuerCode)?.issuerCode ??
              undefined,
            issuerVariantCode:
              order.items.find((item) => item.issuerVariantCode)
                ?.issuerVariantCode ?? undefined,
          }
        : undefined,
      presentedTopicLists: context.presentedLists.map(({ entry }) => ({
        subjectDisplayName: entry.displayName,
        topics: entry.topics.map((topic, index) => ({
          position: index + 1,
          topicName: topic.name,
        })),
      })),
    };
  }
}
