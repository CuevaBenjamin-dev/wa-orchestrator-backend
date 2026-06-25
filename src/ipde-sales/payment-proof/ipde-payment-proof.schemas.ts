import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderStatus,
  IpdePaymentProofStatus,
  IpdePaymentStatus,
} from '@prisma/client';
import { z } from 'zod';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { IpdeOutboundActionsSchema } from '../conversation-engine/ipde-conversation-action.schemas';

const IdSchema = z.string().trim().min(1).max(160);
const ProviderIdSchema = z.string().trim().min(1).max(240);
const SafeFreeTextSchema = z.string().trim().min(1).max(1024);
const Sha256Schema = z.string().trim().min(1).max(160);

const SafeFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('..'), {
    message: 'fileName cannot contain parent directory segments',
  })
  .refine((value) => !hasPathSeparatorOrControlCharacter(value), {
    message: 'fileName cannot contain path separators or control characters',
  });

export const IpdePaymentProofMediaTypeSchema = z.enum(['image', 'document']);

export const IpdePaymentProofMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const IpdePaymentProofRegistrationInputSchema = z
  .object({
    tenantCode: z.literal(IPDE_TENANT_CODE),
    tenantId: IdSchema,
    leadId: IdSchema,
    conversationId: IdSchema,
    provider: z.literal('WHATSAPP').default('WHATSAPP'),
    providerMessageId: ProviderIdSchema.optional(),
    providerMediaId: ProviderIdSchema,
    mediaType: IpdePaymentProofMediaTypeSchema,
    mimeType: IpdePaymentProofMimeTypeSchema.optional(),
    fileName: SafeFileNameSchema.optional(),
    caption: SafeFreeTextSchema.optional(),
    sha256: Sha256Schema.optional(),
    receivedAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mediaType === 'image' && input.mimeType === 'application/pdf') {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'image payment proofs cannot use application/pdf',
      });
    }
    if (
      input.mediaType === 'document' &&
      input.mimeType &&
      input.mimeType !== 'application/pdf'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'document payment proofs must use application/pdf',
      });
    }
  });

export const IpdePaymentProofDetectionInputSchema = z
  .object({
    mediaType: IpdePaymentProofMediaTypeSchema.optional(),
    caption: z.string().trim().max(1024).optional(),
    fileName: z.string().trim().max(200).optional(),
    mimeType: z.string().trim().max(120).optional(),
    currentStage: z.enum(IpdeConversationStage).optional(),
    orderPaymentStatus: z.enum(IpdePaymentStatus).optional(),
    hasPaymentContext: z.boolean().default(false),
    hasQuotedPrice: z.boolean().default(false),
  })
  .strict();

export const IpdePaymentProofDetectionResultSchema = z
  .object({
    kind: z.enum([
      'CONFIRMED_PAYMENT_PROOF',
      'POSSIBLE_PAYMENT_PROOF',
      'NOT_PAYMENT_PROOF',
    ]),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
    reason: z.enum([
      'MEDIA_IN_PAYMENT_CONTEXT',
      'KEYWORD_MATCH_WITHOUT_PAYMENT_CONTEXT',
      'MEDIA_WITHOUT_PAYMENT_CONTEXT',
      'UNSUPPORTED_MEDIA_TYPE',
    ]),
    matchedKeywords: z.array(z.string()).max(20),
  })
  .strict();

export const IpdePaymentProofAppliedChangeSchema = z.discriminatedUnion(
  'type',
  [
    z
      .object({
        type: z.literal('PAYMENT_PROOF_CREATED'),
        paymentProofId: IdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('ORDER_PAYMENT_UNDER_REVIEW'),
        orderId: IdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('STATE_PAYMENT_UNDER_REVIEW'),
        stateId: IdSchema,
      })
      .strict(),
    z
      .object({ type: z.literal('AUTOMATION_PAUSED'), stateId: IdSchema })
      .strict(),
    z.object({ type: z.literal('NO_ACTIVE_ORDER') }).strict(),
  ],
);

export const IpdePaymentProofRegistrationResultSchema = z
  .object({
    paymentProof: z
      .object({
        paymentProofId: IdSchema,
        status: z.enum(IpdePaymentProofStatus),
        isDuplicate: z.boolean(),
        providerMessageId: ProviderIdSchema.nullable(),
        providerMediaId: ProviderIdSchema,
      })
      .strict(),
    order: z
      .object({
        orderId: IdSchema.nullable(),
        statusBefore: z.enum(IpdeOrderStatus).nullable(),
        statusAfter: z.enum(IpdeOrderStatus).nullable(),
        paymentStatusBefore: z.enum(IpdePaymentStatus).nullable(),
        paymentStatusAfter: z.enum(IpdePaymentStatus).nullable(),
      })
      .strict(),
    state: z
      .object({
        stateId: IdSchema,
        stageBefore: z.enum(IpdeConversationStage),
        stageAfter: z.enum(IpdeConversationStage),
        automationModeBefore: z.enum(IpdeAutomationMode),
        automationModeAfter: z.enum(IpdeAutomationMode),
        versionBefore: z.number().int().positive(),
        versionAfter: z.number().int().positive(),
      })
      .strict(),
    appliedChanges: z.array(IpdePaymentProofAppliedChangeSchema).max(20),
    outboundActions: IpdeOutboundActionsSchema,
  })
  .strict();

function hasPathSeparatorOrControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || character === '/' || code < 32 || code === 127;
  });
}
