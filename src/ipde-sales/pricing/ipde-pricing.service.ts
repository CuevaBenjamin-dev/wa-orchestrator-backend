import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductType } from '../../catalog/domain/catalog.types';
import {
  IpdePricingConfigError,
  IpdePricingSelectionError,
} from './ipde-pricing.errors';
import { IpdeDiscountPolicyService } from './ipde-discount-policy.service';
import { IpdePricingConfigService } from './ipde-pricing-config.service';
import {
  IpdeAppliedPricingRule,
  IpdeQuoteDiscountResult,
  IpdeQuoteOrderInput,
  IpdeQuoteOrderItemInput,
  IpdeQuoteOrderResult,
  IpdeSelectedPricingRule,
} from './ipde-pricing.types';

@Injectable()
export class IpdePricingService {
  constructor(
    private readonly config: IpdePricingConfigService,
    private readonly discounts: IpdeDiscountPolicyService,
  ) {}

  quoteOrder(input: IpdeQuoteOrderInput): IpdeQuoteOrderResult {
    if (input.tenantCode !== 'IPDE') {
      throw new IpdePricingSelectionError('INVALID_TENANT_CODE');
    }
    if (input.items.length === 0) {
      throw new IpdePricingSelectionError('EMPTY_QUOTE_ITEMS');
    }

    const config = this.config.getPricingConfig();
    const requestedAt = input.requestedAt ?? new Date();
    const quantity = input.items.length;
    const appliedRules: IpdeAppliedPricingRule[] = [];
    const missingPricingForItems: IpdeQuoteOrderResult['missingPricingForItems'] =
      [];
    let totalRegular = new Prisma.Decimal(0);
    let totalPromotional = new Prisma.Decimal(0);
    let totalMinimum = new Prisma.Decimal(0);

    for (const item of input.items) {
      if (!this.isCompleteItem(item)) {
        missingPricingForItems.push(this.missingItem(item));
        continue;
      }
      const selected = this.selectRule({
        item,
        quantity,
        requestedAt,
      });
      if (!selected) {
        missingPricingForItems.push(this.missingItem(item));
        continue;
      }
      const rule = selected.rule;
      totalRegular = totalRegular.add(rule.regularAmount);
      totalPromotional = totalPromotional.add(rule.promotionalAmount);
      totalMinimum = totalMinimum.add(rule.minimumAuthorizedAmount);
      appliedRules.push({
        itemId: item.itemId,
        ruleId: rule.id,
        regularAmount: toMoney(rule.regularAmount),
        promotionalAmount: toMoney(rule.promotionalAmount),
        minimumAuthorizedAmount: toMoney(rule.minimumAuthorizedAmount),
        promotionLabel: rule.promotionLabel ?? null,
        customerFacingLabel: rule.customerFacingLabel ?? null,
      });
    }

    return {
      currencyCode: config.currencyCode,
      totalRegularAmount: toMoney(totalRegular),
      totalPromotionalAmount: toMoney(totalPromotional),
      totalMinimumAuthorizedAmount: toMoney(totalMinimum),
      appliedRules,
      missingPricingForItems,
      quoteStatus:
        appliedRules.length === input.items.length
          ? 'QUOTED'
          : appliedRules.length > 0
            ? 'PARTIAL'
            : 'NO_MATCH',
      promotionLabel: this.commonPromotionLabel(appliedRules),
    };
  }

  quoteDiscount(input: IpdeQuoteOrderInput): IpdeQuoteDiscountResult {
    return this.discounts.quoteDiscount(this.quoteOrder(input));
  }

  private selectRule(params: {
    item: CompleteQuoteItem;
    quantity: number;
    requestedAt: Date;
  }): IpdeSelectedPricingRule | null {
    const date = params.requestedAt.toISOString().slice(0, 10);
    const candidates = this.config
      .getPricingConfig()
      .rules.filter((rule) => rule.active)
      .filter(
        (rule) =>
          rule.minQuantity <= params.quantity &&
          (rule.maxQuantity === null || rule.maxQuantity >= params.quantity),
      )
      .filter(
        (rule) =>
          (!rule.validFrom || rule.validFrom <= date) &&
          (!rule.validUntil || rule.validUntil >= date),
      )
      .map((rule) => {
        const productRank = productMatchRank(
          rule.productTypeCode,
          params.item.productTypeCode,
        );
        if (
          !matches(rule.categoryCode, params.item.categoryCode) ||
          productRank < 0 ||
          !matches(rule.issuerCode, params.item.issuerCode) ||
          !matches(rule.issuerVariantCode, params.item.issuerVariantCode)
        ) {
          return null;
        }
        return {
          rule,
          productMatchRank: productRank,
          specificity:
            exactScore(rule.categoryCode, params.item.categoryCode) +
            productRank +
            exactScore(rule.issuerCode, params.item.issuerCode) +
            exactScore(rule.issuerVariantCode, params.item.issuerVariantCode),
          priority: rule.priority,
        };
      })
      .filter((value): value is IpdeSelectedPricingRule => value !== null)
      .sort((left, right) => {
        if (right.specificity !== left.specificity) {
          return right.specificity - left.specificity;
        }
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        if (right.productMatchRank !== left.productMatchRank) {
          return right.productMatchRank - left.productMatchRank;
        }
        return left.rule.id.localeCompare(right.rule.id);
      });

    if (candidates.length === 0) return null;
    const [winner, runnerUp] = candidates;
    if (
      runnerUp &&
      winner.specificity === runnerUp.specificity &&
      winner.priority === runnerUp.priority &&
      winner.productMatchRank === runnerUp.productMatchRank
    ) {
      throw new IpdePricingConfigError(
        'AMBIGUOUS_PRICING_RULE',
        'Ambiguous IPDE pricing rule selection',
      );
    }
    return winner;
  }

  private isCompleteItem(
    item: IpdeQuoteOrderItemInput,
  ): item is CompleteQuoteItem {
    return Boolean(
      item.productTypeCode && item.issuerCode && item.issuerVariantCode,
    );
  }

  private missingItem(
    item: IpdeQuoteOrderItemInput,
  ): IpdeQuoteOrderResult['missingPricingForItems'][number] {
    return {
      itemId: item.itemId,
      productTypeCode: item.productTypeCode,
      issuerCode: item.issuerCode,
      issuerVariantCode: item.issuerVariantCode,
      categoryCode: item.categoryCode,
    };
  }

  private commonPromotionLabel(
    appliedRules: IpdeAppliedPricingRule[],
  ): string | null {
    const labels = [
      ...new Set(
        appliedRules
          .map((rule) => rule.promotionLabel)
          .filter((value): value is string => value !== null),
      ),
    ];
    return labels.length === 1 ? labels[0] : null;
  }
}

type CompleteQuoteItem = IpdeQuoteOrderItemInput & {
  productTypeCode: ProductType;
  issuerCode: string;
  issuerVariantCode: string;
};

function matches(ruleValue: string, itemValue: string | null): boolean {
  return ruleValue === 'ANY' || ruleValue === itemValue;
}

function exactScore(ruleValue: string, itemValue: string | null): number {
  return ruleValue !== 'ANY' && ruleValue === itemValue ? 1 : 0;
}

function productMatchRank(ruleValue: string, itemValue: ProductType): number {
  if (ruleValue === 'ANY') return 0;
  if (ruleValue === itemValue) return 2;
  if (ruleValue === 'CURSO' && itemValue.startsWith('CURSO_')) return 1;
  return -1;
}

function toMoney(value: string | Prisma.Decimal): string {
  const decimal =
    value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toFixed(2);
}
