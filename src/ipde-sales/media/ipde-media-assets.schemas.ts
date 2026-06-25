import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { CommercialCategorySchema } from '../../catalog/domain/catalog.schemas';
import {
  COMMERCIAL_CATEGORIES,
  IPDE_TENANT_CODE,
} from '../../catalog/domain/catalog.types';

const StableIdSchema = z.string().regex(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
const ShortTextSchema = z.string().trim().min(1).max(500);
const CaptionSchema = z.string().trim().min(1).max(1024);

export const IpdeMediaAssetTypeSchema = z.enum([
  'PROMOTION_IMAGE',
  'PAYMENT_METHODS_IMAGE',
  'GENERAL_IMAGE',
]);

export const IpdeMediaMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const IpdeMediaCategorySchema = z.union([
  CommercialCategorySchema,
  z.literal('ANY'),
  z.null(),
]);

export function isSafeIpdeStorageKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !hasControlCharacter(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

const SafeStorageKeySchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    if (!isSafeIpdeStorageKey(value)) {
      context.addIssue({ code: 'custom', message: 'Unsafe storage key' });
    }
  });

const SafeFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .superRefine((value, context) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(value) ||
      value.includes('..')
    ) {
      context.addIssue({ code: 'custom', message: 'Unsafe image file name' });
    }
  });

const SafePublicUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) {
        context.addIssue({ code: 'custom', message: 'Unsafe public URL' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid public URL' });
    }
  });

export const IpdeMediaAssetSchema = z
  .object({
    id: StableIdSchema,
    active: z.boolean(),
    priority: z.number().int().nonnegative(),
    type: IpdeMediaAssetTypeSchema,
    categoryCode: IpdeMediaCategorySchema,
    title: ShortTextSchema,
    description: ShortTextSchema.optional(),
    fileName: SafeFileNameSchema.optional(),
    storageKey: SafeStorageKeySchema.optional(),
    publicUrl: SafePublicUrlSchema.optional(),
    whatsappMediaId: z.string().trim().min(1).max(200).optional(),
    mimeType: IpdeMediaMimeTypeSchema,
    caption: CaptionSchema.optional(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (!asset.whatsappMediaId && !asset.publicUrl && !asset.storageKey) {
      context.addIssue({
        code: 'custom',
        message:
          'Media asset requires whatsappMediaId, publicUrl or storageKey',
      });
    }

    if (asset.fileName) {
      const lower = asset.fileName.toLowerCase();
      const matches =
        (asset.mimeType === 'image/jpeg' &&
          (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))) ||
        (asset.mimeType === 'image/png' && lower.endsWith('.png')) ||
        (asset.mimeType === 'image/webp' && lower.endsWith('.webp'));
      if (!matches) {
        context.addIssue({
          code: 'custom',
          path: ['fileName'],
          message: 'File extension does not match mimeType',
        });
      }
    }

    if (
      asset.categoryCode &&
      asset.categoryCode !== 'ANY' &&
      !COMMERCIAL_CATEGORIES.includes(asset.categoryCode)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['categoryCode'],
        message: 'Unknown commercial category',
      });
    }
  });

export const IpdeMediaAssetsConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenantCode: z.literal(IPDE_TENANT_CODE),
    assets: z.array(IpdeMediaAssetSchema),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = config.assets.map((asset) => asset.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Duplicate media asset ID',
      });
    }
  });

export function formatIpdeMediaZodIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
