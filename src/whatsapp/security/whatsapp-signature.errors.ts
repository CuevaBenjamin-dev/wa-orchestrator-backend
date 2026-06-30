export type WhatsappSignatureFailureCode =
  | 'APP_SECRET_MISSING'
  | 'RAW_BODY_MISSING'
  | 'SIGNATURE_HEADER_MISSING'
  | 'SIGNATURE_FORMAT_INVALID'
  | 'SIGNATURE_MISMATCH';

export class WhatsappSignatureValidationError extends Error {
  constructor(readonly code: WhatsappSignatureFailureCode) {
    super(code);
    this.name = 'WhatsappSignatureValidationError';
  }
}
