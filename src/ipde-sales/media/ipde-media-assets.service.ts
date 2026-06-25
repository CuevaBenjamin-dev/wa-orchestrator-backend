import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { loadIpdeMediaAssetsConfig } from './ipde-media-assets.loader';
import {
  IpdeMediaAssetsConfig,
  IpdeMediaAsset,
  IpdeResolvedMediaSource,
} from './ipde-media-assets.types';
import { IpdeMediaAssetsConfigError } from './ipde-media-assets.errors';
import { IpdeMediaSelectionService } from './ipde-media-selection.service';
import { IpdeMediaStorageService } from './ipde-media-storage.service';

const DEFAULT_MEDIA_ASSETS_PATH = './config/ipde/media-assets.json';

@Injectable()
export class IpdeMediaAssetsService implements OnModuleInit {
  private mediaConfig: IpdeMediaAssetsConfig | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly selection: IpdeMediaSelectionService,
    private readonly storage: IpdeMediaStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.mediaConfig = await loadIpdeMediaAssetsConfig(this.configPath());
  }

  async validateConfig(): Promise<void> {
    await loadIpdeMediaAssetsConfig(this.configPath());
  }

  getPromotionImageForCategory(params: {
    tenantCode: 'IPDE';
    categoryCode: string | null;
  }): IpdeMediaAsset | null {
    this.requireTenant(params.tenantCode);
    return this.selection.selectPromotion({
      assets: this.requireConfig().assets,
      categoryCode: params.categoryCode,
    });
  }

  getPaymentMethodsImage(params: {
    tenantCode: 'IPDE';
  }): IpdeMediaAsset | null {
    this.requireTenant(params.tenantCode);
    return this.selection.selectPaymentMethods(this.requireConfig().assets);
  }

  getAssetById(params: {
    tenantCode: 'IPDE';
    assetId: string;
  }): IpdeMediaAsset | null {
    this.requireTenant(params.tenantCode);
    return (
      this.requireConfig().assets.find(
        (asset) => asset.active && asset.id === params.assetId,
      ) ?? null
    );
  }

  resolveMediaSource(asset: IpdeMediaAsset): IpdeResolvedMediaSource {
    if (asset.whatsappMediaId) {
      return { kind: 'WHATSAPP_MEDIA_ID', mediaId: asset.whatsappMediaId };
    }
    if (asset.publicUrl) {
      return { kind: 'PUBLIC_URL', link: asset.publicUrl };
    }
    if (asset.storageKey) {
      return {
        kind: 'STORAGE_KEY',
        storageKey: asset.storageKey,
        filePath: this.storage.resolveStoragePath(asset.storageKey),
      };
    }
    throw new IpdeMediaAssetsConfigError(
      'MEDIA_ASSET_WITHOUT_SOURCE',
      'IPDE media asset has no resolvable media source',
    );
  }

  private requireConfig(): IpdeMediaAssetsConfig {
    if (!this.mediaConfig) {
      throw new IpdeMediaAssetsConfigError(
        'MEDIA_ASSETS_CONFIG_NOT_INITIALIZED',
        'IPDE media assets configuration is not initialized',
      );
    }
    return this.mediaConfig;
  }

  private requireTenant(tenantCode: string): void {
    if (tenantCode !== IPDE_TENANT_CODE) {
      throw new IpdeMediaAssetsConfigError(
        'INVALID_TENANT_CODE',
        'IPDE media assets require tenantCode IPDE',
      );
    }
  }

  private configPath(): string {
    const configured =
      this.config.get<string>('IPDE_MEDIA_ASSETS_PATH')?.trim() ||
      DEFAULT_MEDIA_ASSETS_PATH;
    return resolve(process.cwd(), configured);
  }
}
