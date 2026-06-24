import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadIpdePricingBundle } from './ipde-pricing.loader';
import { IpdePricingConfigError } from './ipde-pricing.errors';

const validRule = {
  id: 'PRICE_VALID_REFERENCE',
  active: true,
  priority: 10,
  categoryCode: 'DERECHO',
  productTypeCode: 'DIPLOMADO',
  issuerCode: 'CAC',
  issuerVariantCode: 'CAC_DECANO',
  minQuantity: 1,
  maxQuantity: null,
  regularAmount: '120.00',
  promotionalAmount: '80.00',
  minimumAuthorizedAmount: '70.00',
};

describe('loadIpdePricingBundle', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipde-pricing-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates pricing references against commercial config', async () => {
    const pricingPath = writePricing([validRule]);
    await expect(
      loadIpdePricingBundle({
        pricingConfigPath: pricingPath,
        commercialConfigPath: resolve(
          process.cwd(),
          'config/ipde/commercial-config.json',
        ),
      }),
    ).resolves.toMatchObject({
      pricingConfig: { rules: [expect.objectContaining({ id: validRule.id })] },
    });
  });

  it('rejects a variant that does not belong to the configured issuer', async () => {
    const pricingPath = writePricing([
      {
        ...validRule,
        id: 'PRICE_VARIANT_MISMATCH',
        issuerCode: 'CAC',
        issuerVariantCode: 'UNT_POSGRADO',
      },
    ]);

    await expect(
      loadIpdePricingBundle({
        pricingConfigPath: pricingPath,
        commercialConfigPath: resolve(
          process.cwd(),
          'config/ipde/commercial-config.json',
        ),
      }),
    ).rejects.toMatchObject<IpdePricingConfigError>({
      code: 'PRICING_VARIANT_ISSUER_MISMATCH',
    });
  });

  function writePricing(rules: unknown[]): string {
    const pricingPath = join(dir, 'pricing-promotions.json');
    writeFileSync(
      pricingPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          tenantCode: 'IPDE',
          currencyCode: 'PEN',
          rules,
        },
        null,
        2,
      ),
      'utf8',
    );
    return pricingPath;
  }
});
