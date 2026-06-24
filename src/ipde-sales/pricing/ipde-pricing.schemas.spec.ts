import { IpdePricingConfigSchema } from './ipde-pricing.schemas';

const baseRule = {
  id: 'PRICE_DERECHO_DIPLOMADO_CAC_DECANO_1',
  active: true,
  priority: 10,
  categoryCode: 'DERECHO',
  productTypeCode: 'DIPLOMADO',
  issuerCode: 'CAC',
  issuerVariantCode: 'CAC_DECANO',
  minQuantity: 1,
  maxQuantity: 1,
  regularAmount: '120.00',
  promotionalAmount: '80.00',
  minimumAuthorizedAmount: '70.00',
};

function config(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    tenantCode: 'IPDE',
    currencyCode: 'PEN',
    rules: [baseRule],
    ...overrides,
  };
}

describe('IpdePricingConfigSchema', () => {
  it('accepts a valid strict pricing configuration', () => {
    expect(IpdePricingConfigSchema.parse(config()).rules).toHaveLength(1);
  });

  it('rejects fields outside the contract', () => {
    expect(() =>
      IpdePricingConfigSchema.parse({
        ...config(),
        unexpected: true,
      }),
    ).toThrow();
  });

  it('rejects invalid monetary ordering and excess decimals', () => {
    expect(() =>
      IpdePricingConfigSchema.parse(
        config({
          rules: [
            {
              ...baseRule,
              regularAmount: '70.00',
              promotionalAmount: '80.00',
            },
          ],
        }),
      ),
    ).toThrow();

    expect(() =>
      IpdePricingConfigSchema.parse(
        config({
          rules: [{ ...baseRule, promotionalAmount: '80.999' }],
        }),
      ),
    ).toThrow();
  });

  it('rejects active overlapping rules with the same exact combination', () => {
    expect(() =>
      IpdePricingConfigSchema.parse(
        config({
          rules: [
            baseRule,
            {
              ...baseRule,
              id: 'PRICE_DERECHO_DIPLOMADO_CAC_DECANO_DUPLICATE',
              minQuantity: 1,
              maxQuantity: 2,
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('allows inactive reference rules to overlap because they do not apply', () => {
    expect(
      IpdePricingConfigSchema.parse(
        config({
          rules: [
            baseRule,
            {
              ...baseRule,
              id: 'PRICE_DERECHO_DIPLOMADO_CAC_DECANO_INACTIVE',
              active: false,
            },
          ],
        }),
      ).rules,
    ).toHaveLength(2);
  });

  it('requires validUntil to be after validFrom', () => {
    expect(() =>
      IpdePricingConfigSchema.parse(
        config({
          rules: [
            {
              ...baseRule,
              validFrom: '2026-06-23',
              validUntil: '2026-06-23',
            },
          ],
        }),
      ),
    ).toThrow();
  });
});
