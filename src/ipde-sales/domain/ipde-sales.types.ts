import { IpdeConversationStage, IpdeOrderStatus, Prisma } from '@prisma/client';

export interface GetOrCreateIpdeStateParams {
  tenantId: string;
  leadId: string;
  conversationId: string;
}

export interface GetIpdeStateParams {
  tenantId: string;
  conversationId: string;
}

export interface TransitionIpdeStateParams extends GetIpdeStateParams {
  expectedVersion: number;
  nextStage: IpdeConversationStage;
  reason?: string;
}

export interface AddIpdeSubjectRequestParams {
  tenantId: string;
  orderId: string;
  displayName: string;
  normalizedName: string;
  categoryCode?: string;
  catalogEntryId?: string;
  catalogSource?: string;
}

export interface AddOrRestoreIpdeOrderItemParams {
  tenantId: string;
  orderId: string;
  subjectRequestId?: string;
  catalogTopicId?: string;
  topicName: string;
  normalizedTopicName: string;
}

export interface SetIpdeQuoteParams {
  tenantId: string;
  orderId: string;
  amount: Prisma.Decimal;
  currencyCode: string;
  confirmed: boolean;
}

export interface ChangeIpdeOrderStatusParams {
  tenantId: string;
  orderId: string;
  nextStatus: IpdeOrderStatus;
}

export type IpdeOrderAggregate = Prisma.IpdeOrderGetPayload<{
  include: {
    subjectRequests: true;
    items: true;
  };
}>;
