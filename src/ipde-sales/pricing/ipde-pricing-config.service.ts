import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { loadIpdePricingBundle } from './ipde-pricing.loader';
import { IpdePricingConfig } from './ipde-pricing.types';
import { IpdePricingConfigError } from './ipde-pricing.errors';

const DEFAULT_PRICING_PROMOTIONS_PATH = './config/ipde/pricing-promotions.json';
const DEFAULT_COMMERCIAL_CONFIG_PATH = './config/ipde/commercial-config.json';

@Injectable()
export class IpdePricingConfigService implements OnModuleInit {
  private pricingConfig: IpdePricingConfig | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const bundle = await loadIpdePricingBundle({
      pricingConfigPath: this.resolvePath(
        'IPDE_PRICING_PROMOTIONS_PATH',
        DEFAULT_PRICING_PROMOTIONS_PATH,
      ),
      commercialConfigPath: this.resolvePath(
        'IPDE_COMMERCIAL_CONFIG_PATH',
        DEFAULT_COMMERCIAL_CONFIG_PATH,
      ),
    });
    this.pricingConfig = bundle.pricingConfig;
  }

  getPricingConfig(): IpdePricingConfig {
    if (!this.pricingConfig) {
      throw new IpdePricingConfigError(
        'PRICING_CONFIG_NOT_INITIALIZED',
        'IPDE pricing configuration is not initialized',
      );
    }
    return this.pricingConfig;
  }

  async validateConfig(): Promise<void> {
    await loadIpdePricingBundle({
      pricingConfigPath: this.resolvePath(
        'IPDE_PRICING_PROMOTIONS_PATH',
        DEFAULT_PRICING_PROMOTIONS_PATH,
      ),
      commercialConfigPath: this.resolvePath(
        'IPDE_COMMERCIAL_CONFIG_PATH',
        DEFAULT_COMMERCIAL_CONFIG_PATH,
      ),
    });
  }

  private resolvePath(key: string, fallback: string): string {
    const configured = this.config.get<string>(key)?.trim() || fallback;
    return resolve(process.cwd(), configured);
  }
}
