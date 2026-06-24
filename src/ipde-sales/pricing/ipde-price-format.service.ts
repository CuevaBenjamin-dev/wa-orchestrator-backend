import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class IpdePriceFormatService {
  format(amount: string | Prisma.Decimal): string {
    const decimal =
      amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
    const normalized = decimal.toFixed(2);
    const withoutTrailingZeros = normalized.endsWith('.00')
      ? normalized.slice(0, -3)
      : normalized;
    return `S/ ${withoutTrailingZeros}`;
  }
}
