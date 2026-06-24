import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CommercialCategorySchema,
  ProductTypeSchema,
} from '../../catalog/domain/catalog.schemas';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import {
  IpdeConfiguredIssuerCodeSchema,
  IpdeConfiguredVariantCodeSchema,
} from '../commercial-config/ipde-commercial-config.schemas';

const StableIdSchema = z.string().regex(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
const DecimalAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
  .superRefine((value, context) => {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.lte(0)) {
      context.addIssue({
        code: 'custom',
        message: 'Amount must be positive',
      });
    }
  });
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ShortTextSchema = z.string().trim().min(1).max(500);

export const IpdePricingCategoryCodeSchema = z.union([
  CommercialCategorySchema,
  z.literal('ANY'),
]);
export const IpdePricingProductTypeCodeSchema = z.union([
  ProductTypeSchema,
  z.literal('ANY'),
]);
export const IpdePricingIssuerCodeSchema = z.union([
  IpdeConfiguredIssuerCodeSchema,
  z.literal('ANY'),
]);
export const IpdePricingIssuerVariantCodeSchema = z.union([
  IpdeConfiguredVariantCodeSchema,
  z.literal('ANY'),
]);

export const IpdePricingRuleSchema = z
  .object({
    id: StableIdSchema,
    active: z.boolean(),
    priority: z.number().int().nonnegative(),
    categoryCode: IpdePricingCategoryCodeSchema,
    productTypeCode: IpdePricingProductTypeCodeSchema,
    issuerCode: IpdePricingIssuerCodeSchema,
    issuerVariantCode: IpdePricingIssuerVariantCodeSchema,
    minQuantity: z.number().int().min(1),
    maxQuantity: z.number().int().min(1).nullable(),
    regularAmount: DecimalAmountSchema,
    promotionalAmount: DecimalAmountSchema,
    minimumAuthorizedAmount: DecimalAmountSchema,
    promotionLabel: ShortTextSchema.optional(),
    customerFacingLabel: ShortTextSchema.optional(),
    validFrom: IsoDateSchema.optional(),
    validUntil: IsoDateSchema.optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.maxQuantity !== null && rule.maxQuantity < rule.minQuantity) {
      context.addIssue({
        code: 'custom',
        path: ['maxQuantity'],
        message:
          'maxQuantity must be null or greater than or equal to minQuantity',
      });
    }
    const regular = new Prisma.Decimal(rule.regularAmount);
    const promotional = new Prisma.Decimal(rule.promotionalAmount);
    const minimum = new Prisma.Decimal(rule.minimumAuthorizedAmount);
    if (regular.lt(promotional)) {
      context.addIssue({
        code: 'custom',
        path: ['regularAmount'],
        message:
          'regularAmount must be greater than or equal to promotionalAmount',
      });
    }
    if (promotional.lt(minimum)) {
      context.addIssue({
        code: 'custom',
        path: ['promotionalAmount'],
        message:
          'promotionalAmount must be greater than or equal to minimumAuthorizedAmount',
      });
    }
    if (
      rule.validFrom &&
      rule.validUntil &&
      rule.validUntil <= rule.validFrom
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'validUntil must be after validFrom',
      });
    }
  });

export const IpdePricingConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenantCode: z.literal(IPDE_TENANT_CODE),
    currencyCode: z.literal('PEN'),
    rules: z.array(IpdePricingRuleSchema),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = config.rules.map((rule) => rule.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['rules'],
        message: 'Duplicate pricing rule ID',
      });
    }

    const activeRules = config.rules.filter((rule) => rule.active);
    activeRules.forEach((rule, leftIndex) => {
      activeRules.slice(leftIndex + 1).forEach((candidate) => {
        if (
          sameCombination(rule, candidate) &&
          quantityRangesOverlap(rule, candidate) &&
          dateRangesOverlap(rule, candidate)
        ) {
          const originalIndex = config.rules.indexOf(candidate);
          context.addIssue({
            code: 'custom',
            path: ['rules', originalIndex],
            message:
              'Active pricing rules with the same exact combination cannot overlap in quantity and validity',
          });
        }
      });
    });
  });

type RuleForOverlap = z.infer<typeof IpdePricingRuleSchema>;

function sameCombination(left: RuleForOverlap, right: RuleForOverlap): boolean {
  return (
    left.categoryCode === right.categoryCode &&
    left.productTypeCode === right.productTypeCode &&
    left.issuerCode === right.issuerCode &&
    left.issuerVariantCode === right.issuerVariantCode
  );
}

function quantityRangesOverlap(
  left: RuleForOverlap,
  right: RuleForOverlap,
): boolean {
  const leftMax = left.maxQuantity ?? Number.POSITIVE_INFINITY;
  const rightMax = right.maxQuantity ?? Number.POSITIVE_INFINITY;
  return left.minQuantity <= rightMax && right.minQuantity <= leftMax;
}

function dateRangesOverlap(
  left: RuleForOverlap,
  right: RuleForOverlap,
): boolean {
  const leftStart = left.validFrom ?? '0000-01-01';
  const leftEnd = left.validUntil ?? '9999-12-31';
  const rightStart = right.validFrom ?? '0000-01-01';
  const rightEnd = right.validUntil ?? '9999-12-31';
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function formatIpdePricingZodIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
