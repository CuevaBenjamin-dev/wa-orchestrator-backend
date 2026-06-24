import { readFile } from 'node:fs/promises';
import {
  CommercialCategory,
  PRODUCT_TYPES,
  ProductType,
} from '../../catalog/domain/catalog.types';
import { IpdeCommercialConfigSchema } from '../commercial-config/ipde-commercial-config.schemas';
import { IpdeCommercialConfig } from '../commercial-config/ipde-commercial-config.types';
import { IpdePricingConfigError } from './ipde-pricing.errors';
import {
  formatIpdePricingZodIssues,
  IpdePricingConfigSchema,
} from './ipde-pricing.schemas';
import { IpdePricingConfig } from './ipde-pricing.types';

export interface IpdePricingBundle {
  pricingConfig: IpdePricingConfig;
  commercialConfig: IpdeCommercialConfig;
}

export async function loadIpdePricingBundle(params: {
  pricingConfigPath: string;
  commercialConfigPath: string;
}): Promise<IpdePricingBundle> {
  const [pricingRaw, commercialRaw] = await Promise.all([
    readJson(params.pricingConfigPath, 'PRICING_CONFIG'),
    readJson(params.commercialConfigPath, 'COMMERCIAL_CONFIG'),
  ]);
  const pricing = IpdePricingConfigSchema.safeParse(pricingRaw);
  if (!pricing.success) {
    throw new IpdePricingConfigError(
      'INVALID_PRICING_CONFIG',
      formatIpdePricingZodIssues(pricing.error.issues),
    );
  }
  const commercial = IpdeCommercialConfigSchema.safeParse(commercialRaw);
  if (!commercial.success) {
    throw new IpdePricingConfigError(
      'INVALID_COMMERCIAL_CONFIG',
      formatIpdePricingZodIssues(commercial.error.issues),
    );
  }
  validateCrossReferences(pricing.data, commercial.data);
  return {
    pricingConfig: pricing.data,
    commercialConfig: commercial.data,
  };
}

async function readJson(path: string, label: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    throw new IpdePricingConfigError(
      label === 'PRICING_CONFIG'
        ? 'PRICING_CONFIG_NOT_READABLE'
        : 'COMMERCIAL_CONFIG_NOT_READABLE',
      `${label} could not be read`,
    );
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new IpdePricingConfigError(
      label === 'PRICING_CONFIG'
        ? 'PRICING_CONFIG_INVALID_JSON'
        : 'COMMERCIAL_CONFIG_INVALID_JSON',
      `${label} contains invalid JSON`,
    );
  }
}

function validateCrossReferences(
  pricing: IpdePricingConfig,
  commercial: IpdeCommercialConfig,
): void {
  const activeProducts = new Set(
    commercial.products
      .filter((product) => product.active)
      .map((product) => product.code),
  );
  const issuers = new Map(
    commercial.issuers.map((issuer) => [issuer.code, issuer]),
  );
  const variants = new Map<
    string,
    {
      issuerCode: string;
      issuerActive: boolean;
      variantActive: boolean;
      products: Set<ProductType>;
      categories: Set<CommercialCategory>;
    }
  >();
  for (const issuer of commercial.issuers) {
    for (const variant of issuer.variants) {
      variants.set(variant.code, {
        issuerCode: issuer.code,
        issuerActive: issuer.active,
        variantActive: variant.active,
        products: new Set(variant.allowedProductTypes),
        categories: new Set(variant.availableForCategories),
      });
    }
  }

  for (const rule of pricing.rules) {
    if (rule.productTypeCode !== 'ANY') {
      if (!PRODUCT_TYPES.includes(rule.productTypeCode)) {
        throw new IpdePricingConfigError(
          'PRICING_UNKNOWN_PRODUCT',
          `Pricing rule ${rule.id} references an unknown product`,
        );
      }
      if (rule.active && !activeProducts.has(rule.productTypeCode)) {
        throw new IpdePricingConfigError(
          'PRICING_INACTIVE_PRODUCT',
          `Active pricing rule ${rule.id} references an inactive product`,
        );
      }
    }

    if (
      rule.categoryCode !== 'ANY' &&
      rule.productTypeCode !== 'ANY' &&
      !allowedProductsForCategory(commercial, rule.categoryCode).includes(
        rule.productTypeCode,
      )
    ) {
      throw new IpdePricingConfigError(
        'PRICING_PRODUCT_NOT_ALLOWED_FOR_CATEGORY',
        `Pricing rule ${rule.id} references a product not allowed for its category`,
      );
    }

    if (rule.issuerCode !== 'ANY') {
      const issuer = issuers.get(rule.issuerCode);
      if (!issuer) {
        throw new IpdePricingConfigError(
          'PRICING_UNKNOWN_ISSUER',
          `Pricing rule ${rule.id} references an unknown issuer`,
        );
      }
      if (rule.active && !issuer.active) {
        throw new IpdePricingConfigError(
          'PRICING_INACTIVE_ISSUER',
          `Active pricing rule ${rule.id} references an inactive issuer`,
        );
      }
    }

    if (rule.issuerVariantCode !== 'ANY') {
      const variant = variants.get(rule.issuerVariantCode);
      if (!variant) {
        throw new IpdePricingConfigError(
          'PRICING_UNKNOWN_VARIANT',
          `Pricing rule ${rule.id} references an unknown variant`,
        );
      }
      if (rule.issuerCode !== 'ANY' && variant.issuerCode !== rule.issuerCode) {
        throw new IpdePricingConfigError(
          'PRICING_VARIANT_ISSUER_MISMATCH',
          `Pricing rule ${rule.id} references a variant outside its issuer`,
        );
      }
      if (rule.active && (!variant.issuerActive || !variant.variantActive)) {
        throw new IpdePricingConfigError(
          'PRICING_INACTIVE_VARIANT',
          `Active pricing rule ${rule.id} references an inactive variant`,
        );
      }
      if (
        rule.productTypeCode !== 'ANY' &&
        !variant.products.has(rule.productTypeCode)
      ) {
        throw new IpdePricingConfigError(
          'PRICING_VARIANT_PRODUCT_NOT_ALLOWED',
          `Pricing rule ${rule.id} references a product not allowed by its variant`,
        );
      }
      if (
        rule.categoryCode !== 'ANY' &&
        !variant.categories.has(rule.categoryCode)
      ) {
        throw new IpdePricingConfigError(
          'PRICING_VARIANT_CATEGORY_NOT_ALLOWED',
          `Pricing rule ${rule.id} references a category not available for its variant`,
        );
      }
    }
  }
}

function allowedProductsForCategory(
  commercial: IpdeCommercialConfig,
  categoryCode: CommercialCategory,
): ProductType[] {
  const categoryRule = commercial.categoryRules.find(
    (rule) => rule.categoryCode === categoryCode,
  );
  const allowed =
    categoryRule?.allowedProductTypes ??
    commercial.defaultRule.allowedProductTypes;
  const active = new Set(
    commercial.products
      .filter((product) => product.active)
      .map((product) => product.code),
  );
  return allowed.filter((product) => active.has(product));
}
