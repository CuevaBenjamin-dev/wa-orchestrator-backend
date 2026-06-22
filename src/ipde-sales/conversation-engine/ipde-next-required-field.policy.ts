import { Injectable } from '@nestjs/common';

export type IpdeNextRequiredField =
  | 'CRITICAL_CLARIFICATION'
  | 'SUBJECT'
  | 'TOPIC_SELECTION'
  | 'PRODUCT_TYPE'
  | 'ISSUER_VARIANT'
  | 'FULL_NAME'
  | 'FULL_NAME_CONFIRMATION'
  | 'ORDER_CONFIRMATION';

export interface IpdeProjectedOrderState {
  hasCriticalClarification: boolean;
  hasSubjectOrTopics: boolean;
  hasPendingTopicList: boolean;
  hasSelectedTopics: boolean;
  allTopicsHaveProduct: boolean;
  allTopicsHaveIssuer: boolean;
  hasFullName: boolean;
  fullNameConfirmed: boolean;
}

@Injectable()
export class IpdeNextRequiredFieldPolicy {
  getNext(state: IpdeProjectedOrderState): IpdeNextRequiredField {
    if (state.hasCriticalClarification) return 'CRITICAL_CLARIFICATION';
    if (!state.hasSubjectOrTopics) return 'SUBJECT';
    if (state.hasPendingTopicList) return 'TOPIC_SELECTION';
    if (!state.hasSelectedTopics) return 'TOPIC_SELECTION';
    if (!state.allTopicsHaveProduct) return 'PRODUCT_TYPE';
    if (!state.allTopicsHaveIssuer) return 'ISSUER_VARIANT';
    if (!state.hasFullName) return 'FULL_NAME';
    if (!state.fullNameConfirmed) return 'FULL_NAME_CONFIRMATION';
    return 'ORDER_CONFIRMATION';
  }
}
