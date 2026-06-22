import { IpdeConversationStage } from '@prisma/client';

export class IpdeConversationStateNotFoundError extends Error {
  constructor() {
    super('IPDE conversation state was not found');
    this.name = 'IpdeConversationStateNotFoundError';
  }
}

export class IpdeConversationOwnershipError extends Error {
  constructor() {
    super('The conversation does not belong to the active tenant and lead');
    this.name = 'IpdeConversationOwnershipError';
  }
}

export class InvalidIpdeStageTransitionError extends Error {
  constructor(
    public readonly currentStage: IpdeConversationStage,
    public readonly nextStage: IpdeConversationStage,
  ) {
    super(
      `IPDE stage transition is not allowed: ${currentStage} -> ${nextStage}`,
    );
    this.name = 'InvalidIpdeStageTransitionError';
  }
}

export class ConcurrentIpdeStateUpdateError extends Error {
  constructor() {
    super('IPDE conversation state changed concurrently');
    this.name = 'ConcurrentIpdeStateUpdateError';
  }
}

export class IpdeActiveOrderNotFoundError extends Error {
  constructor() {
    super('The active IPDE order was not found');
    this.name = 'IpdeActiveOrderNotFoundError';
  }
}

export class IpdeOrderOwnershipError extends Error {
  constructor() {
    super('The IPDE order resource does not belong to the active tenant');
    this.name = 'IpdeOrderOwnershipError';
  }
}

export class DuplicateIpdeSubjectRequestError extends Error {
  constructor() {
    super('The normalized subject already exists in this IPDE order');
    this.name = 'DuplicateIpdeSubjectRequestError';
  }
}

export class DuplicateIpdeOrderItemError extends Error {
  constructor() {
    super('The normalized topic already exists in this IPDE order');
    this.name = 'DuplicateIpdeOrderItemError';
  }
}

export class InvalidIpdeOrderAmountError extends Error {
  constructor() {
    super('The IPDE order amount must be a finite non-negative decimal');
    this.name = 'InvalidIpdeOrderAmountError';
  }
}

export class IpdeOrderAlreadyCompletedError extends Error {
  constructor() {
    super('A completed IPDE order cannot change status');
    this.name = 'IpdeOrderAlreadyCompletedError';
  }
}

export class InvalidIpdeOrderDataError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid IPDE order data: ${field}`);
    this.name = 'InvalidIpdeOrderDataError';
  }
}

export class InvalidIpdeStateDataError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid IPDE conversation state data: ${field}`);
    this.name = 'InvalidIpdeStateDataError';
  }
}
