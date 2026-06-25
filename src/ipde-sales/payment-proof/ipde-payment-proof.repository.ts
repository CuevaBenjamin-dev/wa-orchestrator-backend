import { Injectable } from '@nestjs/common';
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
  IpdeOrder,
  IpdeOrderStatus,
  IpdePaymentProof,
  IpdePaymentProofStatus,
  IpdePaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConcurrentIpdeStateUpdateError,
  IpdeActiveOrderNotFoundError,
  IpdeConversationOwnershipError,
  IpdeConversationStateNotFoundError,
} from '../domain/ipde-sales.errors';
import { IpdePaymentProofDuplicateNotFoundError } from './ipde-payment-proof.errors';
import {
  IpdePaymentProofAppliedChange,
  IpdePaymentProofPersistenceResult,
  IpdePaymentProofRegistrationInput,
} from './ipde-payment-proof.types';

const PAYMENT_PROOF_PAUSE_REASON = 'PAYMENT_PROOF_RECEIVED';

@Injectable()
export class IpdePaymentProofRepository {
  constructor(private readonly prisma: PrismaService) {}

  async registerPaymentProof(
    input: IpdePaymentProofRegistrationInput,
  ): Promise<IpdePaymentProofPersistenceResult> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => this.registerInTransaction(transaction, input),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return this.prisma.$transaction((transaction) =>
          this.returnDuplicateInTransaction(transaction, input),
        );
      }
      throw error;
    }
  }

  private async registerInTransaction(
    transaction: Prisma.TransactionClient,
    input: IpdePaymentProofRegistrationInput,
  ): Promise<IpdePaymentProofPersistenceResult> {
    const { state, order } = await this.loadContext(transaction, input);
    const duplicate = await this.findDuplicate(
      transaction,
      input,
      order?.id ?? null,
    );
    if (duplicate) {
      return this.toResult({
        proof: duplicate,
        duplicate: true,
        stateBefore: state,
        stateAfter: state,
        orderBefore: order,
        orderAfter: order,
        appliedChanges: [],
      });
    }

    const proof = await transaction.ipdePaymentProof.create({
      data: {
        tenantId: input.tenantId,
        orderId: order?.id,
        conversationStateId: state.id,
        conversationId: input.conversationId,
        leadId: input.leadId,
        status: IpdePaymentProofStatus.UNDER_REVIEW,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        providerMediaId: input.providerMediaId,
        mediaType: input.mediaType,
        mimeType: input.mimeType,
        fileName: input.fileName,
        caption: input.caption,
        sha256: input.sha256,
        receivedAt: input.receivedAt,
      },
    });

    const appliedChanges: IpdePaymentProofAppliedChange[] = [
      { type: 'PAYMENT_PROOF_CREATED', paymentProofId: proof.id },
    ];

    let orderAfter = order;
    if (order) {
      orderAfter = await this.moveOrderToPaymentReviewIfNeeded(
        transaction,
        order,
        appliedChanges,
      );
    } else {
      appliedChanges.push({ type: 'NO_ACTIVE_ORDER' });
    }

    const stateAfter = await this.pauseStateForPaymentReviewIfNeeded(
      transaction,
      state,
      appliedChanges,
    );

    return this.toResult({
      proof,
      duplicate: false,
      stateBefore: state,
      stateAfter,
      orderBefore: order,
      orderAfter,
      appliedChanges,
    });
  }

  private async returnDuplicateInTransaction(
    transaction: Prisma.TransactionClient,
    input: IpdePaymentProofRegistrationInput,
  ): Promise<IpdePaymentProofPersistenceResult> {
    const { state, order } = await this.loadContext(transaction, input);
    const duplicate = await this.findDuplicate(
      transaction,
      input,
      order?.id ?? null,
    );
    if (!duplicate) {
      throw new IpdePaymentProofDuplicateNotFoundError();
    }
    return this.toResult({
      proof: duplicate,
      duplicate: true,
      stateBefore: state,
      stateAfter: state,
      orderBefore: order,
      orderAfter: order,
      appliedChanges: [],
    });
  }

  private async loadContext(
    transaction: Prisma.TransactionClient,
    input: IpdePaymentProofRegistrationInput,
  ): Promise<{
    state: IpdeConversationState;
    order: IpdeOrder | null;
  }> {
    const conversation = await transaction.conversation.findFirst({
      where: {
        id: input.conversationId,
        tenantId: input.tenantId,
        leadId: input.leadId,
      },
      select: { id: true },
    });
    if (!conversation) {
      throw new IpdeConversationOwnershipError();
    }

    const state = await transaction.ipdeConversationState.upsert({
      where: { conversationId: input.conversationId },
      update: {},
      create: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        conversationId: input.conversationId,
      },
    });

    if (state.tenantId !== input.tenantId || state.leadId !== input.leadId) {
      throw new IpdeConversationOwnershipError();
    }

    if (!state.activeOrderId) {
      return { state, order: null };
    }

    const order = await transaction.ipdeOrder.findFirst({
      where: {
        id: state.activeOrderId,
        tenantId: input.tenantId,
        conversationStateId: state.id,
      },
    });
    if (!order) {
      throw new IpdeActiveOrderNotFoundError();
    }
    return { state, order };
  }

  private findDuplicate(
    transaction: Prisma.TransactionClient,
    input: IpdePaymentProofRegistrationInput,
    orderId: string | null,
  ): Promise<IpdePaymentProof | null> {
    if (input.providerMessageId) {
      return transaction.ipdePaymentProof.findFirst({
        where: {
          tenantId: input.tenantId,
          providerMessageId: input.providerMessageId,
        },
      });
    }

    return transaction.ipdePaymentProof.findFirst({
      where: {
        tenantId: input.tenantId,
        providerMediaId: input.providerMediaId,
        ...(orderId
          ? { orderId }
          : { orderId: null, conversationId: input.conversationId }),
      },
    });
  }

  private async moveOrderToPaymentReviewIfNeeded(
    transaction: Prisma.TransactionClient,
    order: IpdeOrder,
    appliedChanges: IpdePaymentProofAppliedChange[],
  ): Promise<IpdeOrder> {
    if (!this.canMoveOrderToPaymentReview(order)) {
      return order;
    }

    if (
      order.status === IpdeOrderStatus.PAYMENT_UNDER_REVIEW &&
      order.paymentStatus === IpdePaymentStatus.UNDER_REVIEW
    ) {
      return order;
    }

    const updated = await transaction.ipdeOrder.update({
      where: { id: order.id },
      data: {
        status: IpdeOrderStatus.PAYMENT_UNDER_REVIEW,
        paymentStatus: IpdePaymentStatus.UNDER_REVIEW,
      },
    });
    appliedChanges.push({
      type: 'ORDER_PAYMENT_UNDER_REVIEW',
      orderId: updated.id,
    });
    return updated;
  }

  private canMoveOrderToPaymentReview(order: IpdeOrder): boolean {
    const mutableStatuses: readonly IpdeOrderStatus[] = [
      IpdeOrderStatus.DRAFT,
      IpdeOrderStatus.AWAITING_CONFIRMATION,
      IpdeOrderStatus.CONFIRMED,
      IpdeOrderStatus.AWAITING_PAYMENT,
      IpdeOrderStatus.PAYMENT_UNDER_REVIEW,
    ];
    return mutableStatuses.includes(order.status);
  }

  private async pauseStateForPaymentReviewIfNeeded(
    transaction: Prisma.TransactionClient,
    state: IpdeConversationState,
    appliedChanges: IpdePaymentProofAppliedChange[],
  ): Promise<IpdeConversationState> {
    if (
      state.stage === IpdeConversationStage.PAYMENT_UNDER_REVIEW &&
      state.automationMode === IpdeAutomationMode.PAUSED_HUMAN &&
      state.pauseReason === PAYMENT_PROOF_PAUSE_REASON
    ) {
      return state;
    }

    const now = new Date();
    const result = await transaction.ipdeConversationState.updateMany({
      where: {
        id: state.id,
        tenantId: state.tenantId,
        stateVersion: state.stateVersion,
      },
      data: {
        stage: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
        automationMode: IpdeAutomationMode.PAUSED_HUMAN,
        pauseReason: PAYMENT_PROOF_PAUSE_REASON,
        pausedAt:
          state.automationMode === IpdeAutomationMode.PAUSED_HUMAN &&
          state.pausedAt
            ? state.pausedAt
            : now,
        resumedAt: null,
        stateVersion: { increment: 1 },
        lastTransitionAt: now,
      },
    });

    if (result.count !== 1) {
      throw new ConcurrentIpdeStateUpdateError();
    }

    const updated = await transaction.ipdeConversationState.findFirst({
      where: { id: state.id, tenantId: state.tenantId },
    });
    if (!updated) {
      throw new IpdeConversationStateNotFoundError();
    }

    if (state.stage !== IpdeConversationStage.PAYMENT_UNDER_REVIEW) {
      appliedChanges.push({
        type: 'STATE_PAYMENT_UNDER_REVIEW',
        stateId: updated.id,
      });
    }
    if (state.automationMode !== IpdeAutomationMode.PAUSED_HUMAN) {
      appliedChanges.push({ type: 'AUTOMATION_PAUSED', stateId: updated.id });
    }
    return updated;
  }

  private toResult(params: {
    proof: IpdePaymentProof;
    duplicate: boolean;
    stateBefore: IpdeConversationState;
    stateAfter: IpdeConversationState;
    orderBefore: IpdeOrder | null;
    orderAfter: IpdeOrder | null;
    appliedChanges: IpdePaymentProofAppliedChange[];
  }): IpdePaymentProofPersistenceResult {
    return {
      paymentProof: {
        paymentProofId: params.proof.id,
        status: params.proof.status,
        isDuplicate: params.duplicate,
        providerMessageId: params.proof.providerMessageId,
        providerMediaId: params.proof.providerMediaId,
      },
      order: {
        orderId: params.orderAfter?.id ?? params.orderBefore?.id ?? null,
        statusBefore: params.orderBefore?.status ?? null,
        statusAfter: params.orderAfter?.status ?? null,
        paymentStatusBefore: params.orderBefore?.paymentStatus ?? null,
        paymentStatusAfter: params.orderAfter?.paymentStatus ?? null,
      },
      state: {
        stateId: params.stateAfter.id,
        stageBefore: params.stateBefore.stage,
        stageAfter: params.stateAfter.stage,
        automationModeBefore: params.stateBefore.automationMode,
        automationModeAfter: params.stateAfter.automationMode,
        versionBefore: params.stateBefore.stateVersion,
        versionAfter: params.stateAfter.stateVersion,
      },
      appliedChanges: params.appliedChanges,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
