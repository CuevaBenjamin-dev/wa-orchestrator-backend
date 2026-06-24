import { Injectable } from '@nestjs/common';
import { IpdeCommercialConfigService } from './ipde-commercial-config.service';
import { IpdeModelPdfAsset } from './ipde-commercial-config.types';

@Injectable()
export class IpdeModelPdfSelectionService {
  constructor(private readonly commercial: IpdeCommercialConfigService) {}

  selectForItems(params: {
    tenantCode: 'IPDE';
    items: Array<{
      issuerCode: string | null;
      issuerVariantCode: string | null;
      productTypeCode: string | null;
      categoryCode: string | null;
    }>;
  }): IpdeModelPdfAsset[] {
    const assets = new Map<string, IpdeModelPdfAsset>();
    const combinations = new Set<string>();
    for (const item of params.items) {
      if (
        !item.issuerCode ||
        !item.issuerVariantCode ||
        !item.productTypeCode
      ) {
        continue;
      }
      const key = `${item.issuerCode}:${item.issuerVariantCode}:${item.productTypeCode}:${item.categoryCode ?? ''}`;
      if (combinations.has(key)) continue;
      combinations.add(key);
      const options = this.commercial.getModelPdfOptions({
        tenantCode: params.tenantCode,
        issuerCode: item.issuerCode,
        issuerVariantCode: item.issuerVariantCode,
        productTypeCode: item.productTypeCode,
        categoryCode: item.categoryCode,
      });
      for (const option of options) assets.set(option.id, option);
    }
    return [...assets.values()].sort(
      (left, right) => left.priority - right.priority,
    );
  }
}
