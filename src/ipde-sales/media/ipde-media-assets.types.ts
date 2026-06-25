import { z } from 'zod';
import {
  IpdeMediaAssetSchema,
  IpdeMediaAssetsConfigSchema,
  IpdeMediaAssetTypeSchema,
  IpdeMediaMimeTypeSchema,
} from './ipde-media-assets.schemas';

export type IpdeMediaAsset = z.infer<typeof IpdeMediaAssetSchema>;
export type IpdeMediaAssetsConfig = z.infer<typeof IpdeMediaAssetsConfigSchema>;
export type IpdeMediaAssetType = z.infer<typeof IpdeMediaAssetTypeSchema>;
export type IpdeMediaMimeType = z.infer<typeof IpdeMediaMimeTypeSchema>;

export type IpdeResolvedMediaSource =
  | { kind: 'WHATSAPP_MEDIA_ID'; mediaId: string }
  | { kind: 'PUBLIC_URL'; link: string }
  | { kind: 'STORAGE_KEY'; storageKey: string; filePath: string };
