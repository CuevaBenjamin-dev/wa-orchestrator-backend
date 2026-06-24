export class IpdePricingConfigError extends Error {
  constructor(
    readonly code:
      | 'PRICING_CONFIG_NOT_INITIALIZED'
      | 'PRICING_CONFIG_NOT_READABLE'
      | 'PRICING_CONFIG_INVALID_JSON'
      | 'INVALID_PRICING_CONFIG'
      | 'COMMERCIAL_CONFIG_NOT_READABLE'
      | 'COMMERCIAL_CONFIG_INVALID_JSON'
      | 'INVALID_COMMERCIAL_CONFIG'
      | 'PRICING_UNKNOWN_PRODUCT'
      | 'PRICING_INACTIVE_PRODUCT'
      | 'PRICING_PRODUCT_NOT_ALLOWED_FOR_CATEGORY'
      | 'PRICING_UNKNOWN_ISSUER'
      | 'PRICING_INACTIVE_ISSUER'
      | 'PRICING_UNKNOWN_VARIANT'
      | 'PRICING_INACTIVE_VARIANT'
      | 'PRICING_VARIANT_ISSUER_MISMATCH'
      | 'PRICING_VARIANT_PRODUCT_NOT_ALLOWED'
      | 'PRICING_VARIANT_CATEGORY_NOT_ALLOWED'
      | 'AMBIGUOUS_PRICING_RULE',
    message: string,
  ) {
    super(message);
    this.name = 'IpdePricingConfigError';
  }
}

export class IpdePricingSelectionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_TENANT_CODE'
      | 'EMPTY_QUOTE_ITEMS'
      | 'INCOMPLETE_QUOTE_ITEM'
      | 'NO_PRICING_RULE'
      | 'PARTIAL_PRICING',
    message = code,
  ) {
    super(message);
    this.name = 'IpdePricingSelectionError';
  }
}
