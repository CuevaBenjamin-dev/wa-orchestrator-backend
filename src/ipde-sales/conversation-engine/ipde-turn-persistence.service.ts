import { Injectable } from '@nestjs/common';
import {
  IpdeOrderItemStatus,
  IpdeSubjectRequestStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import {
  ConcurrentIpdeStateUpdateError,
  InvalidIpdeStageTransitionError,
  IpdeActiveOrderNotFoundError,
  IpdeConversationOwnershipError,
} from '../domain/ipde-sales.errors';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeAppliedChange } from './ipde-conversation-turn.schemas';
import {
  IpdeConversationTurnContext,
  IpdeConversationTurnPlan,
  IpdeTurnPersistenceResult,
} from './ipde-conversation-turn.types';

@Injectable()
export class IpdeTurnPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: IpdeStageTransitionPolicy,
  ) {}

  async apply(
    context: IpdeConversationTurnContext,
    plan: IpdeConversationTurnPlan,
  ): Promise<IpdeTurnPersistenceResult> {
    if (
      context.state.stage !== plan.targetStage &&
      !this.transitions.canTransition(context.state.stage, plan.targetStage)
    ) {
      throw new InvalidIpdeStageTransitionError(
        context.state.stage,
        plan.targetStage,
      );
    }
    try {
      return await this.prisma.$transaction(
        (transaction) => this.applyInTransaction(transaction, context, plan),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof ConcurrentIpdeStateUpdateError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034')
      ) {
        throw new ConcurrentIpdeStateUpdateError();
      }
      throw error;
    }
  }

  private async applyInTransaction(
    transaction: Prisma.TransactionClient,
    context: IpdeConversationTurnContext,
    plan: IpdeConversationTurnPlan,
  ): Promise<IpdeTurnPersistenceResult> {
    const state = await transaction.ipdeConversationState.findFirst({
      where: {
        id: context.state.id,
        tenantId: context.input.tenantId,
        leadId: context.input.leadId,
        conversationId: context.input.conversationId,
      },
    });
    if (!state) throw new IpdeConversationOwnershipError();
    if (state.stateVersion !== context.state.stateVersion) {
      throw new ConcurrentIpdeStateUpdateError();
    }

    let order = state.activeOrderId
      ? await transaction.ipdeOrder.findFirst({
          where: {
            id: state.activeOrderId,
            tenantId: context.input.tenantId,
            conversationStateId: state.id,
          },
        })
      : null;
    if (state.activeOrderId && !order) {
      throw new IpdeActiveOrderNotFoundError();
    }
    let createdOrder = false;
    const changes: IpdeAppliedChange[] = [];

    if (!order && plan.ensureOrder) {
      order = await transaction.ipdeOrder.create({
        data: {
          tenantId: context.input.tenantId,
          conversationStateId: state.id,
        },
      });
      createdOrder = true;
      changes.push({ type: 'ORDER_CREATED', orderId: order.id });
    }

    const subjectIds = new Map<string, string>();
    if (order) {
      const existingSubjects = await transaction.ipdeSubjectRequest.findMany({
        where: { tenantId: context.input.tenantId, orderId: order.id },
      });
      for (const subject of existingSubjects) {
        subjectIds.set(subject.normalizedName, subject.id);
      }

      for (const mutation of plan.subjectMutations) {
        let subject = existingSubjects.find(
          (candidate) => candidate.normalizedName === mutation.normalizedName,
        );
        if (!subject) {
          subject = await transaction.ipdeSubjectRequest.create({
            data: {
              tenantId: context.input.tenantId,
              orderId: order.id,
              displayName: mutation.displayName,
              normalizedName: mutation.normalizedName,
              categoryCode: mutation.categoryCode,
              catalogEntryId: mutation.catalogEntryId,
              catalogSource: mutation.catalogSource,
            },
          });
          existingSubjects.push(subject);
          changes.push({ type: 'SUBJECT_ADDED', subjectRequestId: subject.id });
        } else {
          const shouldEnrich =
            (!subject.categoryCode && mutation.categoryCode) ||
            (!subject.catalogEntryId && mutation.catalogEntryId) ||
            (!subject.catalogSource && mutation.catalogSource);
          if (shouldEnrich) {
            subject = await transaction.ipdeSubjectRequest.update({
              where: { id: subject.id },
              data: {
                categoryCode: subject.categoryCode ?? mutation.categoryCode,
                catalogEntryId:
                  subject.catalogEntryId ?? mutation.catalogEntryId,
                catalogSource: subject.catalogSource ?? mutation.catalogSource,
              },
            });
          }
        }
        subjectIds.set(mutation.normalizedName, subject.id);

        if (
          mutation.markListPresented &&
          subject.status === IpdeSubjectRequestStatus.REQUESTED
        ) {
          subject = await transaction.ipdeSubjectRequest.update({
            where: { id: subject.id },
            data: {
              status: IpdeSubjectRequestStatus.LIST_PRESENTED,
              listPresentedAt: new Date(),
            },
          });
          changes.push({
            type: 'SUBJECT_LIST_PRESENTED',
            subjectRequestId: subject.id,
          });
        }
      }

      for (const mutation of plan.itemMutations) {
        const existing = await transaction.ipdeOrderItem.findUnique({
          where: {
            orderId_normalizedTopicName: {
              orderId: order.id,
              normalizedTopicName: mutation.normalizedTopicName,
            },
          },
        });
        const subjectRequestId = mutation.subjectNormalizedName
          ? subjectIds.get(mutation.subjectNormalizedName)
          : undefined;
        if (!existing) {
          const item = await transaction.ipdeOrderItem.create({
            data: {
              tenantId: context.input.tenantId,
              orderId: order.id,
              subjectRequestId,
              catalogTopicId: mutation.catalogTopicId,
              topicName: mutation.topicName,
              normalizedTopicName: mutation.normalizedTopicName,
            },
          });
          changes.push({ type: 'ORDER_ITEM_ADDED', orderItemId: item.id });
        } else if (
          existing.tenantId === context.input.tenantId &&
          existing.status === IpdeOrderItemStatus.REMOVED
        ) {
          const item = await transaction.ipdeOrderItem.update({
            where: { id: existing.id },
            data: {
              subjectRequestId,
              catalogTopicId: mutation.catalogTopicId,
              topicName: mutation.topicName,
              status: IpdeOrderItemStatus.DRAFT,
              removedAt: null,
              confirmedAt: null,
            },
          });
          changes.push({ type: 'ORDER_ITEM_RESTORED', orderItemId: item.id });
        }
      }

      for (const normalizedName of plan.completedSubjectNames) {
        const subjectId = subjectIds.get(normalizedName);
        if (!subjectId) continue;
        const subject = await transaction.ipdeSubjectRequest.findFirst({
          where: {
            id: subjectId,
            tenantId: context.input.tenantId,
            orderId: order.id,
          },
        });
        if (
          subject &&
          subject.status !== IpdeSubjectRequestStatus.SELECTION_COMPLETE
        ) {
          await transaction.ipdeSubjectRequest.update({
            where: { id: subject.id },
            data: {
              status: IpdeSubjectRequestStatus.SELECTION_COMPLETE,
              selectionCompletedAt: new Date(),
            },
          });
          changes.push({
            type: 'SUBJECT_SELECTION_COMPLETED',
            subjectRequestId: subject.id,
          });
        }
      }

      for (const product of plan.productMutations) {
        const items = await transaction.ipdeOrderItem.findMany({
          where: {
            tenantId: context.input.tenantId,
            orderId: order.id,
            status: { not: IpdeOrderItemStatus.REMOVED },
          },
        });
        const target = normalizeCatalogText(product.targetReference ?? '');
        for (const item of items) {
          const subjectMatches =
            product.appliesTo === 'SUBJECT' &&
            item.subjectRequestId &&
            [...subjectIds.entries()].some(
              ([name, id]) => id === item.subjectRequestId && name === target,
            );
          const topicMatches =
            product.appliesTo === 'TOPIC' &&
            item.normalizedTopicName === target;
          if (product.appliesTo !== 'ALL' && !subjectMatches && !topicMatches) {
            continue;
          }
          if (item.productTypeCode && !product.correctionExplicit) {
            continue;
          }
          if (item.productTypeCode === product.productTypeCode) continue;
          await transaction.ipdeOrderItem.update({
            where: { id: item.id },
            data: {
              productTypeCode: product.productTypeCode,
              status:
                item.status === IpdeOrderItemStatus.CONFIRMED
                  ? IpdeOrderItemStatus.DRAFT
                  : item.status,
              confirmedAt:
                item.status === IpdeOrderItemStatus.CONFIRMED
                  ? null
                  : item.confirmedAt,
            },
          });
          changes.push({ type: 'PRODUCT_TYPE_SET', orderItemId: item.id });
        }
      }

      for (const issuer of plan.issuerMutations) {
        const items = await transaction.ipdeOrderItem.findMany({
          where: {
            tenantId: context.input.tenantId,
            orderId: order.id,
            status: { not: IpdeOrderItemStatus.REMOVED },
          },
        });
        const target = normalizeCatalogText(issuer.targetReference ?? '');
        for (const item of items) {
          const subjectMatches =
            issuer.appliesTo === 'SUBJECT' &&
            item.subjectRequestId &&
            [...subjectIds.entries()].some(
              ([name, id]) => id === item.subjectRequestId && name === target,
            );
          const topicMatches =
            issuer.appliesTo === 'TOPIC' && item.normalizedTopicName === target;
          if (issuer.appliesTo !== 'ALL' && !subjectMatches && !topicMatches) {
            continue;
          }
          const hasIssuer = Boolean(item.issuerCode || item.issuerVariantCode);
          if (hasIssuer && !issuer.correctionExplicit) continue;
          if (
            item.issuerCode === issuer.issuerCode &&
            item.issuerVariantCode === issuer.issuerVariantCode
          ) {
            continue;
          }
          await transaction.ipdeOrderItem.update({
            where: { id: item.id },
            data: {
              issuerCode: issuer.issuerCode,
              issuerVariantCode: issuer.issuerVariantCode,
              status:
                item.status === IpdeOrderItemStatus.CONFIRMED
                  ? IpdeOrderItemStatus.DRAFT
                  : item.status,
              confirmedAt:
                item.status === IpdeOrderItemStatus.CONFIRMED
                  ? null
                  : item.confirmedAt,
            },
          });
          changes.push({
            type: 'ISSUER_SELECTION_SET',
            orderItemId: item.id,
          });
        }
      }

      if (
        plan.nameMutation?.confirmExisting &&
        order.fullName &&
        !order.fullNameConfirmedAt
      ) {
        order = await transaction.ipdeOrder.update({
          where: { id: order.id },
          data: { fullNameConfirmedAt: new Date() },
        });
        changes.push({ type: 'FULL_NAME_CONFIRMED', orderId: order.id });
      } else if (plan.nameMutation?.value) {
        const maySet = !order.fullName || plan.nameMutation.correctionExplicit;
        if (maySet && order.fullName !== plan.nameMutation.value) {
          order = await transaction.ipdeOrder.update({
            where: { id: order.id },
            data: {
              fullName: plan.nameMutation.value,
              normalizedFullName: plan.nameMutation.value,
              fullNameConfirmedAt: null,
            },
          });
          changes.push({ type: 'FULL_NAME_SET', orderId: order.id });
        }
      }

      if (plan.quoteMutation) {
        const amount = new Prisma.Decimal(plan.quoteMutation.amount);
        const quoteConfirmed = Boolean(order.quoteConfirmedAt);
        const maySetQuote =
          !quoteConfirmed || plan.quoteMutation.correctionExplicit;
        const sameAmount = order.quotedAmount?.equals(amount) ?? false;
        const sameCurrency =
          order.currencyCode === plan.quoteMutation.currencyCode;
        if (maySetQuote && (!sameAmount || !sameCurrency)) {
          order = await transaction.ipdeOrder.update({
            where: { id: order.id },
            data: {
              quotedAmount: amount,
              currencyCode: plan.quoteMutation.currencyCode,
              quoteConfirmedAt: plan.quoteMutation.confirmed
                ? new Date()
                : null,
            },
          });
          changes.push({ type: 'QUOTE_SET', orderId: order.id });
        }
      }
    }

    const stageChanged = state.stage !== plan.targetStage;
    const shouldWriteState = createdOrder || stageChanged || changes.length > 0;
    let finalState = state;
    if (shouldWriteState) {
      const updated = await transaction.ipdeConversationState.updateMany({
        where: {
          id: state.id,
          tenantId: context.input.tenantId,
          stateVersion: context.state.stateVersion,
        },
        data: {
          activeOrderId: order?.id ?? state.activeOrderId,
          stage: plan.targetStage,
          stateVersion: { increment: 1 },
          lastTransitionAt: stageChanged ? new Date() : state.lastTransitionAt,
        },
      });
      if (updated.count !== 1) throw new ConcurrentIpdeStateUpdateError();
      finalState = await transaction.ipdeConversationState.findUniqueOrThrow({
        where: { id: state.id },
      });
      if (stageChanged) {
        changes.push({
          type: 'STAGE_TRANSITIONED',
          from: state.stage,
          to: plan.targetStage,
        });
      }
    }

    const aggregate = order
      ? await transaction.ipdeOrder.findFirst({
          where: {
            id: order.id,
            tenantId: context.input.tenantId,
            conversationStateId: state.id,
          },
          include: {
            subjectRequests: { orderBy: { createdAt: 'asc' } },
            items: { orderBy: { createdAt: 'asc' } },
          },
        })
      : null;

    return {
      state: finalState,
      order: aggregate,
      createdOrder,
      appliedChanges: changes.length > 0 ? changes : [{ type: 'NO_CHANGE' }],
    };
  }
}
