import { Injectable } from '@nestjs/common';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import { IpdeCommercialConfigService } from './ipde-commercial-config.service';
import { IpdeCommercialSelectionError } from './ipde-commercial-config.errors';

export type IpdeIssuerSelectionResolution =
  | { kind: 'NONE' }
  | {
      kind: 'VALID';
      issuerCode: string;
      issuerVariantCode: string;
    }
  | { kind: 'CLARIFICATION'; reason: string; candidates: string[] };

@Injectable()
export class IpdeIssuerSelectionService {
  constructor(private readonly commercial: IpdeCommercialConfigService) {}

  resolve(params: {
    tenantCode: 'IPDE';
    preference: IpdeMessageExtraction['issuerPreference'];
    itemContexts: Array<{
      categoryCode: string | null;
      productTypeCode: string | null;
    }>;
  }): IpdeIssuerSelectionResolution {
    if (params.preference.confidence <= 0) return { kind: 'NONE' };
    if (
      params.preference.issuerCode === 'UNSPECIFIED' ||
      params.preference.variantCode === 'UNSPECIFIED'
    ) {
      return this.clarification(params, 'AMBIGUOUS_ISSUER');
    }
    const contexts =
      params.itemContexts.length > 0
        ? params.itemContexts
        : [{ categoryCode: null, productTypeCode: null }];
    try {
      for (const context of contexts) {
        this.commercial.validateIssuerSelection({
          tenantCode: params.tenantCode,
          issuerCode: params.preference.issuerCode,
          issuerVariantCode: params.preference.variantCode,
          productTypeCode: context.productTypeCode,
          categoryCode: context.categoryCode,
        });
      }
      return {
        kind: 'VALID',
        issuerCode: params.preference.issuerCode,
        issuerVariantCode: params.preference.variantCode,
      };
    } catch (error) {
      if (!(error instanceof IpdeCommercialSelectionError)) throw error;
      return this.clarification(params, error.code);
    }
  }

  private clarification(
    params: {
      tenantCode: 'IPDE';
      itemContexts: Array<{
        categoryCode: string | null;
        productTypeCode: string | null;
      }>;
    },
    reason: string,
  ): IpdeIssuerSelectionResolution {
    const first = params.itemContexts[0] ?? {
      categoryCode: null,
      productTypeCode: null,
    };
    const options = this.commercial.getIssuerOptions({
      tenantCode: params.tenantCode,
      categoryCode: first.categoryCode,
      productTypeCode: first.productTypeCode,
    });
    return {
      kind: 'CLARIFICATION',
      reason,
      candidates: options.map(
        (option) => `${option.issuerName} - ${option.variantName}`,
      ),
    };
  }
}
