import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IpdeQuoteDiscountResult,
  IpdeQuoteOrderResult,
} from './ipde-pricing.types';

@Injectable()
export class IpdeDiscountPolicyService {
  quoteDiscount(quote: IpdeQuoteOrderResult | null): IpdeQuoteDiscountResult {
    if (!quote) {
      return {
        currencyCode: 'PEN',
        currentAmount: '0.00',
        discountedAmount: '0.00',
        minimumAuthorizedAmount: '0.00',
        discountAvailable: false,
        reason: 'NO_QUOTE',
      };
    }
    if (quote.quoteStatus !== 'QUOTED') {
      return {
        currencyCode: quote.currencyCode,
        currentAmount: quote.totalPromotionalAmount,
        discountedAmount: quote.totalPromotionalAmount,
        minimumAuthorizedAmount: quote.totalMinimumAuthorizedAmount,
        discountAvailable: false,
        reason: 'QUOTE_INCOMPLETE',
      };
    }
    const current = new Prisma.Decimal(quote.totalPromotionalAmount);
    const minimum = new Prisma.Decimal(quote.totalMinimumAuthorizedAmount);
    if (current.lte(minimum)) {
      return {
        currencyCode: quote.currencyCode,
        currentAmount: quote.totalPromotionalAmount,
        discountedAmount: quote.totalPromotionalAmount,
        minimumAuthorizedAmount: quote.totalMinimumAuthorizedAmount,
        discountAvailable: false,
        reason: 'ALREADY_AT_MINIMUM',
      };
    }
    return {
      currencyCode: quote.currencyCode,
      currentAmount: quote.totalPromotionalAmount,
      discountedAmount: quote.totalMinimumAuthorizedAmount,
      minimumAuthorizedAmount: quote.totalMinimumAuthorizedAmount,
      discountAvailable: true,
      reason: 'DISCOUNT_AVAILABLE',
    };
  }
}
