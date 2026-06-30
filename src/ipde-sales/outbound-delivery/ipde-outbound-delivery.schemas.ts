import { z } from 'zod';

const SafeDeliveryTextSchema = z.string().trim().min(1).max(20_000);
const SafeDeliveryContentSchema = z.string().trim().min(1).max(4_000);
const AssetIdSchema = z.string().trim().min(1).max(160);

const TextPayloadSchema = z
  .object({
    kind: z.literal('TEXT'),
    text: SafeDeliveryTextSchema,
    contentForMessage: SafeDeliveryContentSchema,
  })
  .strict();

const ImageAssetPayloadSchema = z
  .object({
    kind: z.literal('IMAGE_ASSET'),
    assetId: AssetIdSchema,
    contentForMessage: SafeDeliveryContentSchema,
  })
  .strict();

const ModelPdfPayloadSchema = z
  .object({
    kind: z.literal('MODEL_PDF_ASSET'),
    modelPdfAssetId: AssetIdSchema,
    contentForMessage: SafeDeliveryContentSchema,
  })
  .strict();

export const IpdeOutboundDeliveryPayloadSchema = z.discriminatedUnion('kind', [
  TextPayloadSchema,
  ImageAssetPayloadSchema,
  ModelPdfPayloadSchema,
]);

export const IpdeOutboundDeliveryConfigSchema = z
  .object({
    maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
    retryDelaySeconds: z.coerce.number().int().min(5).max(3600).default(60),
  })
  .strict();

export type IpdeOutboundDeliveryPayload = z.infer<
  typeof IpdeOutboundDeliveryPayloadSchema
>;

export type IpdeOutboundDeliveryConfig = z.infer<
  typeof IpdeOutboundDeliveryConfigSchema
>;
