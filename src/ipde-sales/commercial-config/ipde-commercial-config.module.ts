import { Module } from '@nestjs/common';
import { IpdeCommercialConfigService } from './ipde-commercial-config.service';
import { IpdeIssuerSelectionService } from './ipde-issuer-selection.service';
import { IpdeModelPdfSelectionService } from './ipde-model-pdf-selection.service';
import { IpdeProductLabelService } from './ipde-product-label.service';

@Module({
  providers: [
    IpdeCommercialConfigService,
    IpdeIssuerSelectionService,
    IpdeModelPdfSelectionService,
    IpdeProductLabelService,
  ],
  exports: [
    IpdeCommercialConfigService,
    IpdeIssuerSelectionService,
    IpdeModelPdfSelectionService,
    IpdeProductLabelService,
  ],
})
export class IpdeCommercialConfigModule {}
