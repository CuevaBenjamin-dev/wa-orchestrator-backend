import { z } from 'zod';
import {
  IpdeCommercialConfigSchema,
  IpdeModelPdfAssetSchema,
  IpdeModelPdfManifestSchema,
} from './ipde-commercial-config.schemas';

export type IpdeCommercialConfig = z.infer<typeof IpdeCommercialConfigSchema>;
export type IpdeModelPdfAsset = z.infer<typeof IpdeModelPdfAssetSchema>;
export type IpdeModelPdfManifest = z.infer<typeof IpdeModelPdfManifestSchema>;
export type IpdeIssuerOption = {
  issuerCode: string;
  issuerName: string;
  variantCode: string;
  variantName: string;
  description: string;
  recommended: boolean;
};
export type IpdeIssuerVariantRecommendation = IpdeIssuerOption & {
  autoApply: false;
};
export type IpdeValidatedIssuerSelection = Omit<
  IpdeIssuerOption,
  'recommended'
>;
