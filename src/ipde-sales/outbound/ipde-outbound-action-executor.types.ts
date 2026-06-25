import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';

export type IpdeOutboundActionType = IpdeOutboundAction['type'];

export interface IpdeOutboundExecutionActionResult {
  actionType: string;
  sequence: number;
  attempted: boolean;
  success: boolean;
  simulated: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
}

export interface IpdeOutboundExecutionResult {
  attempted: boolean;
  simulated: boolean;
  actionResults: IpdeOutboundExecutionActionResult[];
}

export interface IpdeOutboundActionExecutorInput {
  tenantCode: 'IPDE';
  tenantId: string;
  phoneNumberId: string;
  to: string;
  actions: IpdeOutboundAction[];
}
