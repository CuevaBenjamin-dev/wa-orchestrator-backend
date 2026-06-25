import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import {
  COMMERCIAL_CATEGORIES,
  CommercialCategory,
  IPDE_TENANT_CODE,
  PRODUCT_TYPES,
  ProductType,
} from '../../catalog/domain/catalog.types';
import {
  IpdeCommercialConfigError,
  IpdeCommercialSelectionError,
} from './ipde-commercial-config.errors';
import { loadIpdeCommercialBundle } from './ipde-commercial-config.loader';
import {
  IpdeCommercialConfig,
  IpdeIssuerOption,
  IpdeIssuerVariantRecommendation,
  IpdeModelPdfAsset,
  IpdeModelPdfManifest,
  IpdeValidatedIssuerSelection,
} from './ipde-commercial-config.types';

const DEFAULT_COMMERCIAL_CONFIG_PATH = './config/ipde/commercial-config.json';
const DEFAULT_MODEL_PDF_ASSETS_PATH = './config/ipde/model-pdf-assets.json';

@Injectable()
export class IpdeCommercialConfigService implements OnModuleInit {
  private commercialConfig: IpdeCommercialConfig | null = null;
  private modelPdfManifest: IpdeModelPdfManifest | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const bundle = await loadIpdeCommercialBundle({
      commercialConfigPath: this.resolvePath(
        'IPDE_COMMERCIAL_CONFIG_PATH',
        DEFAULT_COMMERCIAL_CONFIG_PATH,
      ),
      modelPdfManifestPath: this.resolvePath(
        'IPDE_MODEL_PDF_ASSETS_PATH',
        DEFAULT_MODEL_PDF_ASSETS_PATH,
      ),
    });
    this.commercialConfig = bundle.commercialConfig;
    this.modelPdfManifest = bundle.modelPdfManifest;
  }

  getCommercialConfig(): IpdeCommercialConfig {
    return this.requireConfig();
  }

  getAllowedProductTypesForCategory(params: {
    tenantCode: 'IPDE';
    categoryCode: string | null;
  }): ProductType[] {
    this.requireTenant(params.tenantCode);
    const config = this.requireConfig();
    const category = this.normalizeCategory(params.categoryCode);
    const rule = category
      ? config.categoryRules.find(
          (candidate) => candidate.categoryCode === category,
        )
      : undefined;
    const allowed =
      rule?.allowedProductTypes ?? config.defaultRule.allowedProductTypes;
    const active = new Set(
      config.products
        .filter((product) => product.active)
        .map((product) => product.code),
    );
    return allowed.filter((product) => active.has(product));
  }

  validateProductSelection(params: {
    tenantCode: 'IPDE';
    categoryCode: string | null;
    productTypeCode: string;
  }): ProductType {
    this.requireTenant(params.tenantCode);
    if (!PRODUCT_TYPES.includes(params.productTypeCode as ProductType)) {
      throw new IpdeCommercialSelectionError('UNKNOWN_PRODUCT_TYPE');
    }
    const product = params.productTypeCode as ProductType;
    const allowed = this.getAllowedProductTypesForCategory({
      tenantCode: params.tenantCode,
      categoryCode: params.categoryCode,
    });
    if (!allowed.includes(product)) {
      throw new IpdeCommercialSelectionError(
        'PRODUCT_NOT_ALLOWED_FOR_CATEGORY',
      );
    }
    return product;
  }

  getRecommendedIssuerVariant(params: {
    tenantCode: 'IPDE';
    categoryCode: string | null;
    productTypeCode?: string | null;
  }): IpdeIssuerVariantRecommendation {
    this.requireTenant(params.tenantCode);
    const config = this.requireConfig();
    const category = this.normalizeCategory(params.categoryCode);
    const rule = category
      ? config.categoryRules.find(
          (candidate) => candidate.categoryCode === category,
        )
      : undefined;
    const recommendation =
      rule?.recommendation ?? config.defaultRule.recommendation;
    const options = this.getIssuerOptions(params);
    const selected = options.find(
      (option) =>
        option.issuerCode === recommendation.issuerCode &&
        option.variantCode === recommendation.variantCode,
    );
    if (!selected) {
      throw new IpdeCommercialConfigError(
        'RECOMMENDATION_NOT_APPLICABLE',
        'Configured recommendation is not applicable to this selection',
      );
    }
    return { ...selected, autoApply: recommendation.autoApply };
  }

  getIssuerOptions(params: {
    tenantCode: 'IPDE';
    categoryCode: string | null;
    productTypeCode?: string | null;
  }): IpdeIssuerOption[] {
    this.requireTenant(params.tenantCode);
    const config = this.requireConfig();
    const category = this.normalizeCategory(params.categoryCode) ?? 'OTROS';
    const product = params.productTypeCode ?? null;
    if (product && !PRODUCT_TYPES.includes(product as ProductType)) {
      throw new IpdeCommercialSelectionError('UNKNOWN_PRODUCT_TYPE');
    }
    const rule = config.categoryRules.find(
      (candidate) => candidate.categoryCode === category,
    );
    const recommendation =
      rule?.recommendation ?? config.defaultRule.recommendation;
    const options = config.issuers.flatMap((issuer) =>
      issuer.active
        ? issuer.variants.flatMap((variant) =>
            variant.active &&
            variant.availableForCategories.includes(category) &&
            (!product ||
              variant.allowedProductTypes.includes(product as ProductType))
              ? [
                  {
                    issuerCode: issuer.code,
                    issuerName: issuer.displayName,
                    variantCode: variant.code,
                    variantName: variant.displayName,
                    description: variant.description,
                    recommended:
                      issuer.code === recommendation.issuerCode &&
                      variant.code === recommendation.variantCode,
                  },
                ]
              : [],
          )
        : [],
    );
    return options.sort(
      (left, right) => Number(right.recommended) - Number(left.recommended),
    );
  }

  validateIssuerSelection(params: {
    tenantCode: 'IPDE';
    issuerCode: string;
    issuerVariantCode: string;
    productTypeCode?: string | null;
    categoryCode?: string | null;
  }): IpdeValidatedIssuerSelection {
    const options = this.getIssuerOptions({
      tenantCode: params.tenantCode,
      categoryCode: params.categoryCode ?? null,
      productTypeCode: params.productTypeCode,
    });
    const selected = options.find(
      (option) =>
        option.issuerCode === params.issuerCode &&
        option.variantCode === params.issuerVariantCode,
    );
    if (!selected) {
      throw new IpdeCommercialSelectionError('ISSUER_VARIANT_NOT_APPLICABLE');
    }
    return {
      issuerCode: selected.issuerCode,
      issuerName: selected.issuerName,
      variantCode: selected.variantCode,
      variantName: selected.variantName,
      description: selected.description,
    };
  }

  getModelPdfOptions(params: {
    tenantCode: 'IPDE';
    issuerCode: string;
    issuerVariantCode: string;
    productTypeCode: string;
    categoryCode?: string | null;
  }): IpdeModelPdfAsset[] {
    this.validateIssuerSelection(params);
    const manifest = this.requireManifest();
    const exact = manifest.assets.filter(
      (asset) =>
        asset.active &&
        asset.issuerCode === params.issuerCode &&
        asset.issuerVariantCode === params.issuerVariantCode &&
        asset.productTypeCode === params.productTypeCode,
    );
    if (exact.length > 0) return this.sortAssets(exact);
    if (params.productTypeCode.startsWith('CURSO_')) {
      return this.sortAssets(
        manifest.assets.filter(
          (asset) =>
            asset.active &&
            asset.issuerCode === params.issuerCode &&
            asset.issuerVariantCode === params.issuerVariantCode &&
            asset.productTypeCode === 'CURSO',
        ),
      );
    }
    return [];
  }

  getModelPdfAssetById(params: {
    tenantCode: 'IPDE';
    assetId: string;
  }): IpdeModelPdfAsset | null {
    this.requireTenant(params.tenantCode);
    const manifest = this.requireManifest();
    return (
      manifest.assets.find(
        (asset) => asset.active && asset.id === params.assetId,
      ) ?? null
    );
  }

  private requireConfig(): IpdeCommercialConfig {
    if (!this.commercialConfig) {
      throw new IpdeCommercialConfigError(
        'COMMERCIAL_CONFIG_NOT_INITIALIZED',
        'IPDE commercial configuration is not initialized',
      );
    }
    return this.commercialConfig;
  }

  private requireManifest(): IpdeModelPdfManifest {
    if (!this.modelPdfManifest) {
      throw new IpdeCommercialConfigError(
        'MODEL_PDF_MANIFEST_NOT_INITIALIZED',
        'IPDE model PDF manifest is not initialized',
      );
    }
    return this.modelPdfManifest;
  }

  private requireTenant(tenantCode: string): void {
    if (tenantCode !== IPDE_TENANT_CODE) {
      throw new IpdeCommercialSelectionError('INVALID_TENANT_CODE');
    }
  }

  private normalizeCategory(value: string | null): CommercialCategory | null {
    return value && COMMERCIAL_CATEGORIES.includes(value as CommercialCategory)
      ? (value as CommercialCategory)
      : null;
  }

  private resolvePath(key: string, fallback: string): string {
    const configured = this.config.get<string>(key)?.trim() || fallback;
    return resolve(process.cwd(), configured);
  }

  private sortAssets(assets: IpdeModelPdfAsset[]): IpdeModelPdfAsset[] {
    return [...assets].sort((left, right) => left.priority - right.priority);
  }
}
