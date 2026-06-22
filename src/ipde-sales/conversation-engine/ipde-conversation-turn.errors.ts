export class IpdeConversationTurnConflictError extends Error {
  constructor() {
    super(
      'The IPDE conversation turn could not be applied after concurrent updates',
    );
    this.name = 'IpdeConversationTurnConflictError';
  }
}

export class InvalidIpdeConversationTurnPlanError extends Error {
  constructor(public readonly code: string) {
    super(`Invalid IPDE conversation turn plan: ${code}`);
    this.name = 'InvalidIpdeConversationTurnPlanError';
  }
}
