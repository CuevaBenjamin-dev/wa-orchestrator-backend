import { Prisma } from '@prisma/client';
import {
  CommercialCategory,
  ProductType,
} from '../../catalog/domain/catalog.types';
import {
  IpdePricingConfigSchema,
  IpdePricingRuleSchema,
} from './ipde-pricing.schemas';
import { z } from 'zod';

export type IpdePricingConfig = z.infer<typeof IpdePricingConfigSchema>;
export type IpdePricingRule = z.infer<typeof IpdePricingRuleSchema>;

export interface IpdeQuoteOrderItemInput {
  itemId: string;
  categoryCode: CommercialCategory | null;
  productTypeCode: ProductType | null;
  issuerCode: string | null;
  issuerVariantCode: string | null;
}

export interface IpdeQuoteOrderInput {
  tenantCode: 'IPDE';
  categoryCode: CommercialCategory | null;
  items: IpdeQuoteOrderItemInput[];
  requestedAt?: Date;
}

export interface IpdeAppliedPricingRule {
  itemId: string;
  ruleId: string;
  regularAmount: string;
  promotionalAmount: string;
  minimumAuthorizedAmount: string;
  promotionLabel: string | null;
  customerFacingLabel: string | null;
}

export interface IpdeMissingPricingItem {
  itemId: string;
  productTypeCode: ProductType | null;
  issuerCode: string | null;
  issuerVariantCode: string | null;
  categoryCode: CommercialCategory | null;
}

export type IpdeQuoteStatus = 'QUOTED' | 'PARTIAL' | 'NO_MATCH';

export interface IpdeQuoteOrderResult {
  currencyCode: 'PEN';
  totalRegularAmount: string;
  totalPromotionalAmount: string;
  totalMinimumAuthorizedAmount: string;
  appliedRules: IpdeAppliedPricingRule[];
  missingPricingForItems: IpdeMissingPricingItem[];
  quoteStatus: IpdeQuoteStatus;
  promotionLabel: string | null;
}

export type IpdeQuoteDiscountReason =
  | 'DISCOUNT_AVAILABLE'
  | 'ALREADY_AT_MINIMUM'
  | 'QUOTE_INCOMPLETE'
  | 'NO_QUOTE';

export interface IpdeQuoteDiscountResult {
  currencyCode: 'PEN';
  currentAmount: string;
  discountedAmount: string;
  minimumAuthorizedAmount: string;
  discountAvailable: boolean;
  reason: IpdeQuoteDiscountReason;
}

export interface IpdeSelectedPricingRule {
  rule: IpdePricingRule;
  specificity: number;
  priority: number;
  productMatchRank: number;
}

export type IpdeMoney = Prisma.Decimal;
