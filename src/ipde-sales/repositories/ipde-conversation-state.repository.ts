import { Injectable } from '@nestjs/common';
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeConversationState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConcurrentIpdeStateUpdateError,
  IpdeConversationOwnershipError,
  IpdeConversationStateNotFoundError,
} from '../domain/ipde-sales.errors';
import {
  GetIpdeStateParams,
  GetOrCreateIpdeStateParams,
} from '../domain/ipde-sales.types';

@Injectable()
export class IpdeConversationStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  getOrCreate(
    params: GetOrCreateIpdeStateParams,
  ): Promise<IpdeConversationState> {
    return this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: {
          id: params.conversationId,
          tenantId: params.tenantId,
        },
        select: {
          leadId: true,
          lead: {
            select: {
              tenantId: true,
            },
          },
        },
      });

      if (
        !conversation ||
        conversation.leadId !== params.leadId ||
        conversation.lead.tenantId !== params.tenantId
      ) {
        throw new IpdeConversationOwnershipError();
      }

      const state = await transaction.ipdeConversationState.upsert({
        where: {
          conversationId: params.conversationId,
        },
        update: {},
        create: {
          tenantId: params.tenantId,
          leadId: params.leadId,
          conversationId: params.conversationId,
        },
      });

      if (
        state.tenantId !== params.tenantId ||
        state.leadId !== params.leadId
      ) {
        throw new IpdeConversationOwnershipError();
      }

      return state;
    });
  }

  findByConversation(
    params: GetIpdeStateParams,
  ): Promise<IpdeConversationState | null> {
    return this.prisma.ipdeConversationState.findFirst({
      where: {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      },
    });
  }

  async transition(params: {
    id: string;
    tenantId: string;
    expectedVersion: number;
    nextStage: IpdeConversationStage;
    reason?: string;
  }): Promise<IpdeConversationState> {
    const now = new Date();
    const shouldPause =
      params.nextStage === IpdeConversationStage.PAYMENT_UNDER_REVIEW ||
      params.nextStage === IpdeConversationStage.HUMAN_TAKEOVER;
    const data: Prisma.IpdeConversationStateUpdateManyMutationInput = {
      stage: params.nextStage,
      stateVersion: { increment: 1 },
      lastTransitionAt: now,
      ...(shouldPause
        ? {
            automationMode: IpdeAutomationMode.PAUSED_HUMAN,
            pauseReason: params.reason ?? 'HUMAN_REVIEW_REQUIRED',
            pausedAt: now,
            resumedAt: null,
          }
        : {}),
    };

    const result = await this.prisma.ipdeConversationState.updateMany({
      where: {
        id: params.id,
        tenantId: params.tenantId,
        stateVersion: params.expectedVersion,
      },
      data,
    });

    if (result.count !== 1) {
      throw new ConcurrentIpdeStateUpdateError();
    }

    return this.getUpdatedState(params.id, params.tenantId);
  }

  pauseForHuman(params: {
    id: string;
    tenantId: string;
    expectedVersion: number;
    preservePaymentReview: boolean;
    reason: string;
  }): Promise<IpdeConversationState> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const result = await transaction.ipdeConversationState.updateMany({
        where: {
          id: params.id,
          tenantId: params.tenantId,
          stateVersion: params.expectedVersion,
        },
        data: {
          stage: params.preservePaymentReview
            ? IpdeConversationStage.PAYMENT_UNDER_REVIEW
            : IpdeConversationStage.HUMAN_TAKEOVER,
          automationMode: IpdeAutomationMode.PAUSED_HUMAN,
          pauseReason: params.reason,
          pausedAt: now,
          resumedAt: null,
          stateVersion: { increment: 1 },
          lastTransitionAt: now,
        },
      });

      if (result.count !== 1) {
        throw new ConcurrentIpdeStateUpdateError();
      }

      const state = await transaction.ipdeConversationState.findFirst({
        where: { id: params.id, tenantId: params.tenantId },
      });
      if (!state) {
        throw new IpdeConversationStateNotFoundError();
      }
      return state;
    });
  }

  resumeAutomation(params: {
    id: string;
    tenantId: string;
    expectedVersion: number;
  }): Promise<IpdeConversationState> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.ipdeConversationState.updateMany({
        where: {
          id: params.id,
          tenantId: params.tenantId,
          stateVersion: params.expectedVersion,
        },
        data: {
          automationMode: IpdeAutomationMode.ACTIVE,
          resumedAt: new Date(),
          stateVersion: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        throw new ConcurrentIpdeStateUpdateError();
      }

      const state = await transaction.ipdeConversationState.findFirst({
        where: { id: params.id, tenantId: params.tenantId },
      });
      if (!state) {
        throw new IpdeConversationStateNotFoundError();
      }
      return state;
    });
  }

  private async getUpdatedState(
    id: string,
    tenantId: string,
  ): Promise<IpdeConversationState> {
    const state = await this.prisma.ipdeConversationState.findFirst({
      where: { id, tenantId },
    });
    if (!state) {
      throw new IpdeConversationStateNotFoundError();
    }
    return state;
  }
}
