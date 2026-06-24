import { z } from 'zod';
import {
  CommercialCategorySchema,
  ProductTypeSchema,
} from '../../catalog/domain/catalog.schemas';
import {
  COMMERCIAL_CATEGORIES,
  IPDE_TENANT_CODE,
  PRODUCT_TYPES,
} from '../../catalog/domain/catalog.types';

export const IPDE_CONFIGURED_ISSUER_CODES = ['CAC', 'UNT'] as const;
export const IPDE_CONFIGURED_VARIANT_CODES = [
  'CAC_DECANO',
  'UNT_DIRECTORAL',
  'UNT_POSGRADO',
] as const;

export const IpdeConfiguredIssuerCodeSchema = z.enum(
  IPDE_CONFIGURED_ISSUER_CODES,
);
export const IpdeConfiguredVariantCodeSchema = z.enum(
  IPDE_CONFIGURED_VARIANT_CODES,
);

const ShortTextSchema = z.string().trim().min(1).max(500);
const StableIdSchema = z.string().regex(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
const UniqueProductTypesSchema = z
  .array(ProductTypeSchema)
  .min(1)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate product type' });
    }
  });
const UniqueCategoriesSchema = z
  .array(CommercialCategorySchema)
  .min(1)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate category' });
    }
  });

const ProductConfigSchema = z
  .object({
    code: ProductTypeSchema,
    active: z.boolean(),
  })
  .strict();

const IssuerVariantSchema = z
  .object({
    code: IpdeConfiguredVariantCodeSchema,
    displayName: ShortTextSchema,
    description: ShortTextSchema,
    active: z.boolean(),
    allowedProductTypes: UniqueProductTypesSchema,
    availableForCategories: UniqueCategoriesSchema,
  })
  .strict();

const IssuerSchema = z
  .object({
    code: IpdeConfiguredIssuerCodeSchema,
    displayName: ShortTextSchema,
    active: z.boolean(),
    variants: z.array(IssuerVariantSchema).min(1),
  })
  .strict()
  .superRefine((issuer, context) => {
    const codes = issuer.variants.map((variant) => variant.code);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Duplicate issuer variant',
      });
    }
  });

const RecommendationSchema = z
  .object({
    issuerCode: IpdeConfiguredIssuerCodeSchema,
    variantCode: IpdeConfiguredVariantCodeSchema,
    autoApply: z.literal(false),
  })
  .strict();

const CategoryRuleSchema = z
  .object({
    categoryCode: CommercialCategorySchema,
    allowedProductTypes: UniqueProductTypesSchema,
    recommendation: RecommendationSchema,
  })
  .strict();

const DefaultRuleSchema = z
  .object({
    allowedProductTypes: UniqueProductTypesSchema,
    recommendation: RecommendationSchema,
  })
  .strict();

export const IpdeCommercialConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenantCode: z.literal(IPDE_TENANT_CODE),
    tenantDisplayName: z.string().trim().min(3).max(200),
    products: z.array(ProductConfigSchema).length(PRODUCT_TYPES.length),
    issuers: z.array(IssuerSchema).length(IPDE_CONFIGURED_ISSUER_CODES.length),
    categoryRules: z.array(CategoryRuleSchema),
    defaultRule: DefaultRuleSchema,
  })
  .strict()
  .superRefine((config, context) => {
    const productCodes = config.products.map((product) => product.code);
    if (new Set(productCodes).size !== productCodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['products'],
        message: 'Duplicate configured product',
      });
    }
    const issuerCodes = config.issuers.map((issuer) => issuer.code);
    if (new Set(issuerCodes).size !== issuerCodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['issuers'],
        message: 'Duplicate issuer',
      });
    }
    const categoryCodes = config.categoryRules.map((rule) => rule.categoryCode);
    if (new Set(categoryCodes).size !== categoryCodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['categoryRules'],
        message: 'Duplicate category rule',
      });
    }

    const activeProducts = new Set(
      config.products
        .filter((product) => product.active)
        .map((product) => product.code),
    );
    const variants = new Map<
      string,
      {
        issuerCode: string;
        issuerActive: boolean;
        variantActive: boolean;
        products: Set<string>;
        categories: Set<string>;
      }
    >();
    for (const issuer of config.issuers) {
      for (const variant of issuer.variants) {
        if (variants.has(variant.code)) {
          context.addIssue({
            code: 'custom',
            path: ['issuers'],
            message: `Variant declared more than once: ${variant.code}`,
          });
        }
        variants.set(variant.code, {
          issuerCode: issuer.code,
          issuerActive: issuer.active,
          variantActive: variant.active,
          products: new Set(variant.allowedProductTypes),
          categories: new Set(variant.availableForCategories),
        });
        const expectedIssuer = variant.code.startsWith('CAC_') ? 'CAC' : 'UNT';
        if (issuer.code !== expectedIssuer) {
          context.addIssue({
            code: 'custom',
            path: ['issuers'],
            message: `Variant ${variant.code} belongs to ${expectedIssuer}`,
          });
        }
        for (const product of variant.allowedProductTypes) {
          if (!activeProducts.has(product)) {
            context.addIssue({
              code: 'custom',
              path: ['issuers'],
              message: `Variant references inactive product: ${product}`,
            });
          }
        }
      }
    }

    const rules = [config.defaultRule, ...config.categoryRules];
    rules.forEach((rule, index) => {
      for (const product of rule.allowedProductTypes) {
        if (!activeProducts.has(product)) {
          context.addIssue({
            code: 'custom',
            path: index === 0 ? ['defaultRule'] : ['categoryRules', index - 1],
            message: `Rule references inactive product: ${product}`,
          });
        }
      }
      const variant = variants.get(rule.recommendation.variantCode);
      if (
        !variant ||
        variant.issuerCode !== rule.recommendation.issuerCode ||
        !variant.issuerActive ||
        !variant.variantActive
      ) {
        context.addIssue({
          code: 'custom',
          path: index === 0 ? ['defaultRule'] : ['categoryRules', index - 1],
          message: 'Recommendation references an inactive or unrelated variant',
        });
        return;
      }
      const categories =
        index === 0
          ? COMMERCIAL_CATEGORIES
          : [config.categoryRules[index - 1].categoryCode];
      if (
        rule.allowedProductTypes.some(
          (product) => !variant.products.has(product),
        ) ||
        categories.some((category) => !variant.categories.has(category))
      ) {
        context.addIssue({
          code: 'custom',
          path: index === 0 ? ['defaultRule'] : ['categoryRules', index - 1],
          message: 'Recommendation is not applicable to its rule',
        });
      }
    });
  });

const SafeFileNameSchema = z
  .string()
  .min(1)
  .max(200)
  .superRefine((value, context) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i.test(value) ||
      value.includes('..')
    ) {
      context.addIssue({ code: 'custom', message: 'Unsafe PDF file name' });
    }
  });

const SafeStorageKeySchema = z
  .string()
  .min(1)
  .max(300)
  .superRefine((value, context) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9/_-]*\.pdf$/i.test(value) ||
      value.includes('..') ||
      value.startsWith('/') ||
      value.includes('\\')
    ) {
      context.addIssue({ code: 'custom', message: 'Unsafe storage key' });
    }
  });

const SafePublicUrlSchema = z
  .string()
  .min(1)
  .max(500)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) {
        context.addIssue({ code: 'custom', message: 'Unsafe public URL' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid public URL' });
    }
  });

export const IpdeModelPdfAssetSchema = z
  .object({
    id: StableIdSchema,
    tenantCode: z.literal(IPDE_TENANT_CODE),
    issuerCode: IpdeConfiguredIssuerCodeSchema,
    issuerVariantCode: IpdeConfiguredVariantCodeSchema,
    productTypeCode: ProductTypeSchema,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(500),
    fileName: SafeFileNameSchema,
    storageKey: SafeStorageKeySchema.optional(),
    publicUrl: SafePublicUrlSchema.optional(),
    whatsappMediaId: z.string().trim().min(1).max(200).optional(),
    active: z.boolean(),
    priority: z.number().int().nonnegative(),
  })
  .strict();

export const IpdeModelPdfManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenantCode: z.literal(IPDE_TENANT_CODE),
    assets: z.array(IpdeModelPdfAssetSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.assets.map((asset) => asset.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Duplicate model PDF asset ID',
      });
    }
    const combinations = manifest.assets.map(
      (asset) =>
        `${asset.issuerVariantCode}:${asset.productTypeCode}:${asset.priority}`,
    );
    if (new Set(combinations).size !== combinations.length) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Duplicate model PDF combination and priority',
      });
    }
  });
