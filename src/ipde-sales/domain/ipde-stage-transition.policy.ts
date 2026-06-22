import { Injectable } from '@nestjs/common';
import { IpdeConversationStage } from '@prisma/client';

export const IPDE_STAGE_TRANSITIONS: Readonly<
  Record<IpdeConversationStage, readonly IpdeConversationStage[]>
> = {
  NEW: [
    IpdeConversationStage.UNDERSTANDING_REQUEST,
    IpdeConversationStage.WAITING_FOR_SUBJECT,
    IpdeConversationStage.TOPICS_SELECTED,
    IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  UNDERSTANDING_REQUEST: [
    IpdeConversationStage.WAITING_FOR_SUBJECT,
    IpdeConversationStage.TOPIC_LIST_READY,
    IpdeConversationStage.TOPICS_SELECTED,
    IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_SUBJECT: [
    IpdeConversationStage.TOPIC_LIST_READY,
    IpdeConversationStage.TOPICS_SELECTED,
    IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  TOPIC_LIST_READY: [
    IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    IpdeConversationStage.TOPICS_SELECTED,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_TOPIC_SELECTION: [
    IpdeConversationStage.TOPICS_SELECTED,
    IpdeConversationStage.WAITING_FOR_SUBJECT,
    IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  TOPICS_SELECTED: [
    IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.WAITING_FOR_ORDER_CONFIRMATION,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_PRODUCT_TYPE: [
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.WAITING_FOR_ORDER_CONFIRMATION,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_ISSUER_VARIANT: [
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.WAITING_FOR_ORDER_CONFIRMATION,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_FULL_NAME: [
    IpdeConversationStage.WAITING_FOR_ORDER_CONFIRMATION,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_ORDER_CONFIRMATION: [
    IpdeConversationStage.WAITING_FOR_PAYMENT,
    IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
    IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
    IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
    IpdeConversationStage.WAITING_FOR_FULL_NAME,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  WAITING_FOR_PAYMENT: [
    IpdeConversationStage.PAYMENT_UNDER_REVIEW,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  PAYMENT_UNDER_REVIEW: [IpdeConversationStage.HUMAN_TAKEOVER],
  HUMAN_TAKEOVER: [
    IpdeConversationStage.READY_FOR_ISSUANCE,
    IpdeConversationStage.COMPLETED,
  ],
  READY_FOR_ISSUANCE: [
    IpdeConversationStage.COMPLETED,
    IpdeConversationStage.HUMAN_TAKEOVER,
  ],
  COMPLETED: [],
};

@Injectable()
export class IpdeStageTransitionPolicy {
  canTransition(
    currentStage: IpdeConversationStage,
    nextStage: IpdeConversationStage,
  ): boolean {
    return IPDE_STAGE_TRANSITIONS[currentStage].includes(nextStage);
  }

  isTerminal(stage: IpdeConversationStage): boolean {
    return stage === IpdeConversationStage.COMPLETED;
  }
}
