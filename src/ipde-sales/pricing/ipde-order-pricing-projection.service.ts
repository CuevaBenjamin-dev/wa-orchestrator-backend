import { Injectable } from '@nestjs/common';
import { IpdeOrderItemStatus } from '@prisma/client';
import {
  CommercialCategory,
  ProductType,
} from '../../catalog/domain/catalog.types';
import { IpdeOrderAggregate } from '../domain/ipde-sales.types';
import { IpdeQuoteOrderItemInput } from './ipde-pricing.types';

export interface IpdeProjectedPricingItem {
  itemId: string;
  categoryCode: string | null;
  productTypeCode: string | null;
  issuerCode: string | null;
  issuerVariantCode: string | null;
}

@Injectable()
export class IpdeOrderPricingProjectionService {
  fromOrder(order: IpdeOrderAggregate): IpdeQuoteOrderItemInput[] {
    const subjectById = new Map(
      order.subjectRequests.map((subject) => [subject.id, subject]),
    );
    return order.items
      .filter((item) => item.status !== IpdeOrderItemStatus.REMOVED)
      .map((item) => ({
        itemId: item.id,
        categoryCode: this.asCategory(
          item.subjectRequestId
            ? subjectById.get(item.subjectRequestId)?.categoryCode
            : null,
        ),
        productTypeCode: this.asProduct(item.productTypeCode),
        issuerCode: item.issuerCode,
        issuerVariantCode: item.issuerVariantCode,
      }));
  }

  fromProjectedItems(
    items: IpdeProjectedPricingItem[],
  ): IpdeQuoteOrderItemInput[] {
    return items.map((item) => ({
      itemId: item.itemId,
      categoryCode: this.asCategory(item.categoryCode),
      productTypeCode: this.asProduct(item.productTypeCode),
      issuerCode: item.issuerCode,
      issuerVariantCode: item.issuerVariantCode,
    }));
  }

  private asProduct(value: string | null): ProductType | null {
    return value && this.isProduct(value) ? value : null;
  }

  private asCategory(
    value: string | null | undefined,
  ): CommercialCategory | null {
    return value && this.isCategory(value) ? value : null;
  }

  private isProduct(value: string): value is ProductType {
    return [
      'DIPLOMADO',
      'ESPECIALIZACION',
      'CURSO',
      'CURSO_CAPACITACION',
      'CURSO_ACTUALIZACION',
      'CURSO_ESPECIALIZACION',
    ].includes(value);
  }

  private isCategory(value: string): value is CommercialCategory {
    return [
      'DERECHO',
      'EDUCACION',
      'GESTION_PUBLICA',
      'SALUD',
      'INGENIERIA',
      'ADMINISTRACION',
      'CONTABILIDAD',
      'PSICOLOGIA',
      'TECNOLOGIA',
      'OTROS',
    ].includes(value);
  }
}
