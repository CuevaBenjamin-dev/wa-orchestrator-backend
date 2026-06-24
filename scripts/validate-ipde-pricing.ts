import { resolve } from 'node:path';
import { loadIpdePricingBundle } from '../src/ipde-sales/pricing/ipde-pricing.loader';
import { IpdePricingConfigError } from '../src/ipde-sales/pricing/ipde-pricing.errors';

const DEFAULT_PRICING_PROMOTIONS_PATH = './config/ipde/pricing-promotions.json';
const DEFAULT_COMMERCIAL_CONFIG_PATH = './config/ipde/commercial-config.json';

async function main(): Promise<void> {
  const bundle = await loadIpdePricingBundle({
    pricingConfigPath: resolvePath(
      process.env.IPDE_PRICING_PROMOTIONS_PATH,
      DEFAULT_PRICING_PROMOTIONS_PATH,
    ),
    commercialConfigPath: resolvePath(
      process.env.IPDE_COMMERCIAL_CONFIG_PATH,
      DEFAULT_COMMERCIAL_CONFIG_PATH,
    ),
  });
  const activeRules = bundle.pricingConfig.rules.filter(
    (rule) => rule.active,
  ).length;
  console.log(
    `IPDE pricing configuration is valid: ${bundle.pricingConfig.rules.length} rules, ${activeRules} active`,
  );
}

function resolvePath(value: string | undefined, fallback: string): string {
  return resolve(process.cwd(), value?.trim() || fallback);
}

main().catch((error: unknown) => {
  if (error instanceof IpdePricingConfigError) {
    console.error(`${error.code}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error('UNKNOWN_ERROR: IPDE pricing configuration validation failed');
  process.exitCode = 1;
});
