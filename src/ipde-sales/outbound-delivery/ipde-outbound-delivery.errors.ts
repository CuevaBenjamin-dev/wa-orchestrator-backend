export type IpdeOutboundDeliveryErrorCode =
  | 'INVALID_TENANT_CODE'
  | 'INVALID_OUTBOUND_DELIVERY_PAYLOAD'
  | 'MEDIA_ASSET_NOT_FOUND'
  | 'MODEL_PDF_ASSET_NOT_FOUND'
  | 'MODEL_PDF_ASSET_WITHOUT_MEDIA';

export class IpdeOutboundDeliveryError extends Error {
  constructor(readonly code: IpdeOutboundDeliveryErrorCode) {
    super(code);
    this.name = 'IpdeOutboundDeliveryError';
  }
}
