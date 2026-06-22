import { Injectable } from '@nestjs/common';
import { IpdeConversationStage, IpdeConversationState } from '@prisma/client';
import {
  InvalidIpdeStateDataError,
  InvalidIpdeStageTransitionError,
  IpdeConversationStateNotFoundError,
} from '../domain/ipde-sales.errors';
import {
  GetIpdeStateParams,
  GetOrCreateIpdeStateParams,
  TransitionIpdeStateParams,
} from '../domain/ipde-sales.types';
import { IpdeStageTransitionPolicy } from '../domain/ipde-stage-transition.policy';
import { IpdeConversationStateRepository } from '../repositories/ipde-conversation-state.repository';

const MAX_PAUSE_REASON_LENGTH = 500;

@Injectable()
export class IpdeConversationStateService {
  constructor(
    private readonly states: IpdeConversationStateRepository,
    private readonly transitions: IpdeStageTransitionPolicy,
  ) {}

  getOrCreateState(
    params: GetOrCreateIpdeStateParams,
  ): Promise<IpdeConversationState> {
    return this.states.getOrCreate(params);
  }

  getState(params: GetIpdeStateParams): Promise<IpdeConversationState | null> {
    return this.states.findByConversation(params);
  }

  async transition(
    params: TransitionIpdeStateParams,
  ): Promise<IpdeConversationState> {
    const state = await this.requireState(params);
    if (!this.transitions.canTransition(state.stage, params.nextStage)) {
      throw new InvalidIpdeStageTransitionError(state.stage, params.nextStage);
    }

    return this.states.transition({
      id: state.id,
      tenantId: params.tenantId,
      expectedVersion: params.expectedVersion,
      nextStage: params.nextStage,
      reason: params.reason ? this.requireReason(params.reason) : undefined,
    });
  }

  async pauseForHuman(params: {
    tenantId: string;
    conversationId: string;
    reason: string;
  }): Promise<IpdeConversationState> {
    const state = await this.requireState(params);
    if (this.transitions.isTerminal(state.stage)) {
      throw new InvalidIpdeStageTransitionError(
        state.stage,
        IpdeConversationStage.HUMAN_TAKEOVER,
      );
    }

    return this.states.pauseForHuman({
      id: state.id,
      tenantId: params.tenantId,
      expectedVersion: state.stateVersion,
      preservePaymentReview:
        state.stage === IpdeConversationStage.PAYMENT_UNDER_REVIEW,
      reason: this.requireReason(params.reason),
    });
  }

  async resumeAutomation(
    params: GetIpdeStateParams,
  ): Promise<IpdeConversationState> {
    const state = await this.requireState(params);
    if (state.stage === IpdeConversationStage.PAYMENT_UNDER_REVIEW) {
      throw new InvalidIpdeStageTransitionError(state.stage, state.stage);
    }

    return this.states.resumeAutomation({
      id: state.id,
      tenantId: params.tenantId,
      expectedVersion: state.stateVersion,
    });
  }

  private async requireState(
    params: GetIpdeStateParams,
  ): Promise<IpdeConversationState> {
    const state = await this.states.findByConversation(params);
    if (!state) {
      throw new IpdeConversationStateNotFoundError();
    }
    return state;
  }

  private requireReason(reason: string): string {
    const normalized = reason.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > MAX_PAUSE_REASON_LENGTH) {
      throw new InvalidIpdeStateDataError('reason');
    }
    return normalized;
  }
}
