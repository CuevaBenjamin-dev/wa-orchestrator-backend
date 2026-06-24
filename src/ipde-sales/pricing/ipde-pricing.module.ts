import { Module } from '@nestjs/common';
import { IpdeCommercialConfigModule } from '../commercial-config/ipde-commercial-config.module';
import { IpdeDiscountPolicyService } from './ipde-discount-policy.service';
import { IpdeOrderPricingProjectionService } from './ipde-order-pricing-projection.service';
import { IpdePriceFormatService } from './ipde-price-format.service';
import { IpdePricingConfigService } from './ipde-pricing-config.service';
import { IpdePricingService } from './ipde-pricing.service';

@Module({
  imports: [IpdeCommercialConfigModule],
  providers: [
    IpdePricingConfigService,
    IpdePricingService,
    IpdePriceFormatService,
    IpdeDiscountPolicyService,
    IpdeOrderPricingProjectionService,
  ],
  exports: [
    IpdePricingConfigService,
    IpdePricingService,
    IpdePriceFormatService,
    IpdeDiscountPolicyService,
    IpdeOrderPricingProjectionService,
  ],
})
export class IpdePricingModule {}
