import { IpdeOutboundDelivery } from '@prisma/client';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeOutboundDeliveryPayload } from './ipde-outbound-delivery.schemas';

export interface IpdePlannedOutboundDelivery {
  actionType: string;
  sequence: number;
  payload: IpdeOutboundDeliveryPayload;
}

export interface IpdeOutboundDeliveryCreateInput {
  tenantId: string;
  leadId?: string;
  conversationId: string;
  orderId?: string | null;
  inboundMessageId?: string;
  inboundExternalId: string;
  actions: IpdeOutboundAction[];
}

export interface IpdeOutboundDeliveryExecutionInput {
  tenantCode: 'IPDE';
  tenantId: string;
  phoneNumberId: string;
  to: string;
  inboundExternalId: string;
}

export interface IpdeOutboundDeliveryRetryInput {
  tenantCode: 'IPDE';
  tenantId: string;
  limit: number;
}

export interface IpdeOutboundDeliveryExecutionResult {
  attempted: boolean;
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
  deliveries: IpdeOutboundDelivery[];
}
