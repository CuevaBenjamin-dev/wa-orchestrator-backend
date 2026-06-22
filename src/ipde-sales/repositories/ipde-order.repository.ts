import { Injectable } from '@nestjs/common';
import {
  IpdeOrder,
  IpdeOrderItem,
  IpdeOrderItemStatus,
  IpdeOrderStatus,
  IpdePaymentStatus,
  IpdeSubjectRequest,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DuplicateIpdeOrderItemError,
  DuplicateIpdeSubjectRequestError,
  IpdeActiveOrderNotFoundError,
  IpdeConversationStateNotFoundError,
  IpdeOrderAlreadyCompletedError,
  IpdeOrderOwnershipError,
} from '../domain/ipde-sales.errors';
import {
  AddIpdeSubjectRequestParams,
  AddOrRestoreIpdeOrderItemParams,
  ChangeIpdeOrderStatusParams,
  IpdeOrderAggregate,
} from '../domain/ipde-sales.types';

const MAX_TRANSACTION_ATTEMPTS = 3;

class ActiveOrderRaceError extends Error {}

@Injectable()
export class IpdeOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveOrder(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<IpdeOrder | null> {
    const state = await this.prisma.ipdeConversationState.findFirst({
      where: {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      },
    });
    if (!state?.activeOrderId) {
      return null;
    }

    const order = await this.prisma.ipdeOrder.findFirst({
      where: {
        id: state.activeOrderId,
        tenantId: params.tenantId,
        conversationStateId: state.id,
      },
    });
    if (!order) {
      throw new IpdeActiveOrderNotFoundError();
    }
    return order;
  }

  async getActiveOrderAggregate(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<IpdeOrderAggregate | null> {
    const state = await this.prisma.ipdeConversationState.findFirst({
      where: {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      },
      select: { id: true, activeOrderId: true },
    });
    if (!state?.activeOrderId) return null;

    const order = await this.prisma.ipdeOrder.findFirst({
      where: {
        id: state.activeOrderId,
        tenantId: params.tenantId,
        conversationStateId: state.id,
      },
      include: {
        subjectRequests: { orderBy: { createdAt: 'asc' } },
        items: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new IpdeActiveOrderNotFoundError();
    return order;
  }

  async getOrCreateActiveOrder(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<IpdeOrder> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) =>
            this.getOrCreateActiveOrderInTransaction(transaction, params),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          !this.isRetryableActiveOrderRace(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }

    throw new IpdeActiveOrderNotFoundError();
  }

  async addSubjectRequest(
    params: AddIpdeSubjectRequestParams,
  ): Promise<IpdeSubjectRequest> {
    await this.requireOrder(params.tenantId, params.orderId);
    try {
      return await this.prisma.ipdeSubjectRequest.create({
        data: {
          tenantId: params.tenantId,
          orderId: params.orderId,
          displayName: params.displayName,
          normalizedName: params.normalizedName,
          categoryCode: params.categoryCode,
          catalogEntryId: params.catalogEntryId,
          catalogSource: params.catalogSource,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new DuplicateIpdeSubjectRequestError();
      }
      throw error;
    }
  }

  async addOrRestoreOrderItem(
    params: AddOrRestoreIpdeOrderItemParams,
  ): Promise<IpdeOrderItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const order = await transaction.ipdeOrder.findFirst({
          where: { id: params.orderId, tenantId: params.tenantId },
        });
        if (!order) {
          throw new IpdeOrderOwnershipError();
        }

        if (params.subjectRequestId) {
          const subject = await transaction.ipdeSubjectRequest.findFirst({
            where: {
              id: params.subjectRequestId,
              tenantId: params.tenantId,
              orderId: params.orderId,
            },
          });
          if (!subject) {
            throw new IpdeOrderOwnershipError();
          }
        }

        const existing = await transaction.ipdeOrderItem.findUnique({
          where: {
            orderId_normalizedTopicName: {
              orderId: params.orderId,
              normalizedTopicName: params.normalizedTopicName,
            },
          },
        });
        if (existing) {
          if (
            existing.tenantId !== params.tenantId ||
            existing.status !== IpdeOrderItemStatus.REMOVED
          ) {
            throw new DuplicateIpdeOrderItemError();
          }

          return transaction.ipdeOrderItem.update({
            where: { id: existing.id },
            data: {
              subjectRequestId: params.subjectRequestId,
              catalogTopicId: params.catalogTopicId,
              topicName: params.topicName,
              status: IpdeOrderItemStatus.DRAFT,
              removedAt: null,
              confirmedAt: null,
            },
          });
        }

        return transaction.ipdeOrderItem.create({
          data: {
            tenantId: params.tenantId,
            orderId: params.orderId,
            subjectRequestId: params.subjectRequestId,
            catalogTopicId: params.catalogTopicId,
            topicName: params.topicName,
            normalizedTopicName: params.normalizedTopicName,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new DuplicateIpdeOrderItemError();
      }
      throw error;
    }
  }

  async setItemProductType(params: {
    tenantId: string;
    orderItemId: string;
    productTypeCode: string;
  }): Promise<IpdeOrderItem> {
    await this.requireItem(params.tenantId, params.orderItemId);
    return this.prisma.ipdeOrderItem.update({
      where: { id: params.orderItemId },
      data: { productTypeCode: params.productTypeCode },
    });
  }

  async setItemIssuerSelection(params: {
    tenantId: string;
    orderItemId: string;
    issuerCode: string;
    issuerVariantCode: string;
  }): Promise<IpdeOrderItem> {
    await this.requireItem(params.tenantId, params.orderItemId);
    return this.prisma.ipdeOrderItem.update({
      where: { id: params.orderItemId },
      data: {
        issuerCode: params.issuerCode,
        issuerVariantCode: params.issuerVariantCode,
      },
    });
  }

  async setCustomerFullName(params: {
    tenantId: string;
    orderId: string;
    fullName: string;
    normalizedFullName: string;
    confirmed: boolean;
  }): Promise<IpdeOrder> {
    await this.requireOrder(params.tenantId, params.orderId);
    return this.prisma.ipdeOrder.update({
      where: { id: params.orderId },
      data: {
        fullName: params.fullName,
        normalizedFullName: params.normalizedFullName,
        fullNameConfirmedAt: params.confirmed ? new Date() : null,
      },
    });
  }

  async setQuote(params: {
    tenantId: string;
    orderId: string;
    amount: Prisma.Decimal;
    currencyCode: string;
    confirmed: boolean;
  }): Promise<IpdeOrder> {
    await this.requireOrder(params.tenantId, params.orderId);
    return this.prisma.ipdeOrder.update({
      where: { id: params.orderId },
      data: {
        quotedAmount: params.amount,
        currencyCode: params.currencyCode,
        quoteConfirmedAt: params.confirmed ? new Date() : null,
      },
    });
  }

  changeOrderStatus(params: ChangeIpdeOrderStatusParams): Promise<IpdeOrder> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.ipdeOrder.findFirst({
        where: { id: params.orderId, tenantId: params.tenantId },
      });
      if (!order) {
        throw new IpdeOrderOwnershipError();
      }
      if (order.status === IpdeOrderStatus.COMPLETED) {
        throw new IpdeOrderAlreadyCompletedError();
      }

      const updated = await transaction.ipdeOrder.update({
        where: { id: order.id },
        data: this.statusUpdate(params.nextStatus),
      });

      if (
        params.nextStatus === IpdeOrderStatus.COMPLETED ||
        params.nextStatus === IpdeOrderStatus.CANCELLED
      ) {
        await transaction.ipdeConversationState.updateMany({
          where: {
            id: order.conversationStateId,
            tenantId: params.tenantId,
            activeOrderId: order.id,
          },
          data: { activeOrderId: null },
        });
      }

      return updated;
    });
  }

  private async getOrCreateActiveOrderInTransaction(
    transaction: Prisma.TransactionClient,
    params: { tenantId: string; conversationId: string },
  ): Promise<IpdeOrder> {
    const state = await transaction.ipdeConversationState.findFirst({
      where: {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      },
    });
    if (!state) {
      throw new IpdeConversationStateNotFoundError();
    }

    if (state.activeOrderId) {
      const activeOrder = await transaction.ipdeOrder.findFirst({
        where: {
          id: state.activeOrderId,
          tenantId: params.tenantId,
          conversationStateId: state.id,
        },
      });
      if (!activeOrder) {
        throw new IpdeActiveOrderNotFoundError();
      }
      return activeOrder;
    }

    const order = await transaction.ipdeOrder.create({
      data: {
        tenantId: params.tenantId,
        conversationStateId: state.id,
      },
    });
    const assigned = await transaction.ipdeConversationState.updateMany({
      where: {
        id: state.id,
        tenantId: params.tenantId,
        activeOrderId: null,
      },
      data: { activeOrderId: order.id },
    });
    if (assigned.count !== 1) {
      throw new ActiveOrderRaceError();
    }
    return order;
  }

  private async requireOrder(
    tenantId: string,
    orderId: string,
  ): Promise<IpdeOrder> {
    const order = await this.prisma.ipdeOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new IpdeOrderOwnershipError();
    }
    return order;
  }

  private async requireItem(
    tenantId: string,
    itemId: string,
  ): Promise<IpdeOrderItem> {
    const item = await this.prisma.ipdeOrderItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) {
      throw new IpdeOrderOwnershipError();
    }
    return item;
  }

  private statusUpdate(
    nextStatus: IpdeOrderStatus,
  ): Prisma.IpdeOrderUncheckedUpdateInput {
    const now = new Date();
    const data: Prisma.IpdeOrderUncheckedUpdateInput = { status: nextStatus };

    if (nextStatus === IpdeOrderStatus.CONFIRMED) {
      data.confirmedAt = now;
    } else if (nextStatus === IpdeOrderStatus.AWAITING_PAYMENT) {
      data.paymentStatus = IpdePaymentStatus.AWAITING_PROOF;
    } else if (nextStatus === IpdeOrderStatus.PAYMENT_UNDER_REVIEW) {
      data.paymentStatus = IpdePaymentStatus.UNDER_REVIEW;
    } else if (nextStatus === IpdeOrderStatus.READY_FOR_ISSUANCE) {
      data.readyForIssuanceAt = now;
    } else if (nextStatus === IpdeOrderStatus.COMPLETED) {
      data.completedAt = now;
    } else if (nextStatus === IpdeOrderStatus.CANCELLED) {
      data.cancelledAt = now;
    }

    return data;
  }

  private isRetryableActiveOrderRace(error: unknown): boolean {
    return (
      error instanceof ActiveOrderRaceError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034')
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
