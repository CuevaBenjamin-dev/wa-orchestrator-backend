export class IpdePaymentProofContextError extends Error {
  constructor() {
    super('The payment proof context does not belong to the active tenant');
    this.name = 'IpdePaymentProofContextError';
  }
}

export class IpdePaymentProofDuplicateNotFoundError extends Error {
  constructor() {
    super('A payment proof duplicate was expected but was not found');
    this.name = 'IpdePaymentProofDuplicateNotFoundError';
  }
}
