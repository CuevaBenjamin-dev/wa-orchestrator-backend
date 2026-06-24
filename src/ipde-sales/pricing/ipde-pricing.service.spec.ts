import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { IpdeDiscountPolicyService } from './ipde-discount-policy.service';
import { IpdePriceFormatService } from './ipde-price-format.service';
import { IpdePricingConfigService } from './ipde-pricing-config.service';
import { IpdePricingConfigError } from './ipde-pricing.errors';
import { IpdePricingService } from './ipde-pricing.service';
import {
  IpdePricingConfig,
  IpdeQuoteOrderItemInput,
} from './ipde-pricing.types';

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ipde-pricing-cases.json'), 'utf8'),
) as {
  cases: Array<{
    name: string;
    items: IpdeQuoteOrderItemInput[];
    expectedPromotionalAmount: string;
    expectedDiscountedAmount: string;
  }>;
};

class StubPricingConfigService {
  constructor(private readonly config: IpdePricingConfig) {}

  getPricingConfig(): IpdePricingConfig {
    return this.config;
  }
}

describe('IpdePricingService', () => {
  let service: IpdePricingService;

  beforeAll(async () => {
    const config = new IpdePricingConfigService(new ConfigService());
    await config.onModuleInit();
    service = new IpdePricingService(config, new IpdeDiscountPolicyService());
  });

  it.each(fixture.cases)('quotes fixture: $name', (testCase) => {
    const quote = service.quoteOrder({
      tenantCode: 'IPDE',
      categoryCode: null,
      items: testCase.items,
      requestedAt: new Date('2026-06-23T12:00:00.000Z'),
    });

    expect(quote.quoteStatus).toBe('QUOTED');
    expect(quote.totalPromotionalAmount).toBe(
      testCase.expectedPromotionalAmount,
    );
    expect(quote.totalMinimumAuthorizedAmount).not.toBeUndefined();

    const discount = service.quoteDiscount({
      tenantCode: 'IPDE',
      categoryCode: null,
      items: testCase.items,
      requestedAt: new Date('2026-06-23T12:00:00.000Z'),
    });
    expect(discount.discountedAmount).toBe(testCase.expectedDiscountedAmount);
  });

  it('does not apply inactive catch-all rules', () => {
    const quote = service.quoteOrder({
      tenantCode: 'IPDE',
      categoryCode: null,
      items: [
        {
          itemId: 'missing-1',
          categoryCode: 'DERECHO',
          productTypeCode: 'CURSO',
          issuerCode: 'CAC',
          issuerVariantCode: 'CAC_DECANO',
        },
      ],
    });

    expect(quote.quoteStatus).toBe('NO_MATCH');
    expect(quote.totalPromotionalAmount).toBe('0.00');
  });

  it('formats prices without currency confusion', () => {
    const formatter = new IpdePriceFormatService();
    expect(formatter.format('80.00')).toBe('S/ 80');
    expect(formatter.format('80.50')).toBe('S/ 80.50');
    expect(formatter.format('120.00')).toBe('S/ 120');
  });

  it('detects an ambiguous rule tie instead of choosing silently', () => {
    const ambiguous = pricingConfig([
      {
        id: 'PRICE_CATEGORY_PRODUCT',
        categoryCode: 'DERECHO',
        productTypeCode: 'DIPLOMADO',
        issuerCode: 'ANY',
        issuerVariantCode: 'ANY',
      },
      {
        id: 'PRICE_PRODUCT_ISSUER',
        categoryCode: 'ANY',
        productTypeCode: 'DIPLOMADO',
        issuerCode: 'CAC',
        issuerVariantCode: 'ANY',
      },
    ]);
    const ambiguousService = new IpdePricingService(
      new StubPricingConfigService(
        ambiguous,
      ) as unknown as IpdePricingConfigService,
      new IpdeDiscountPolicyService(),
    );

    expect(() =>
      ambiguousService.quoteOrder({
        tenantCode: 'IPDE',
        categoryCode: null,
        items: [
          {
            itemId: 'ambiguous-1',
            categoryCode: 'DERECHO',
            productTypeCode: 'DIPLOMADO',
            issuerCode: 'CAC',
            issuerVariantCode: 'CAC_DECANO',
          },
        ],
      }),
    ).toThrow(IpdePricingConfigError);
  });

  it('keeps a partial quote from inventing a final total', () => {
    const quote = service.quoteOrder({
      tenantCode: 'IPDE',
      categoryCode: null,
      items: [
        {
          itemId: 'priced-1',
          categoryCode: 'DERECHO',
          productTypeCode: 'DIPLOMADO',
          issuerCode: 'CAC',
          issuerVariantCode: 'CAC_DECANO',
        },
        {
          itemId: 'missing-1',
          categoryCode: 'DERECHO',
          productTypeCode: 'CURSO',
          issuerCode: 'CAC',
          issuerVariantCode: 'CAC_DECANO',
        },
      ],
    });

    expect(quote.quoteStatus).toBe('PARTIAL');
    expect(quote.missingPricingForItems).toHaveLength(1);
  });
});

function pricingConfig(
  rules: Array<Partial<IpdePricingConfig['rules'][number]>>,
): IpdePricingConfig {
  return {
    schemaVersion: 1,
    tenantCode: 'IPDE',
    currencyCode: 'PEN',
    rules: rules.map((rule) => ({
      active: true,
      priority: 10,
      minQuantity: 1,
      maxQuantity: null,
      regularAmount: '120.00',
      promotionalAmount: '80.00',
      minimumAuthorizedAmount: '70.00',
      promotionLabel: 'Promoción vigente',
      customerFacingLabel: 'Precio promocional',
      ...rule,
    })) as IpdePricingConfig['rules'],
  };
}
