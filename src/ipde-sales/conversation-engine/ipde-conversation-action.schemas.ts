import { z } from 'zod';
import { ProductTypeSchema } from '../../catalog/domain/catalog.schemas';

const DraftSchema = z.string().trim().min(1).max(20_000);
const ShortTextSchema = z.string().trim().min(1).max(500);

const NoAutomatedResponseSchema = z
  .object({
    type: z.literal('NO_AUTOMATED_RESPONSE'),
    reason: z.enum([
      'PAUSED_HUMAN',
      'AUTOMATION_DISABLED',
      'PAYMENT_UNDER_REVIEW',
    ]),
  })
  .strict();

const AskSubjectOrDirectTopicsSchema = z
  .object({
    type: z.literal('ASK_SUBJECT_OR_DIRECT_TOPICS'),
    messageDraft: DraftSchema,
  })
  .strict();

const AskSubjectSchema = z
  .object({ type: z.literal('ASK_SUBJECT'), messageDraft: DraftSchema })
  .strict();

const AskClarificationSchema = z
  .object({
    type: z.literal('ASK_CLARIFICATION'),
    reason: z.string().trim().min(1).max(80),
    candidates: z.array(ShortTextSchema).max(10),
    messageDraft: DraftSchema,
  })
  .strict();

const TopicSchema = z
  .object({
    position: z.number().int().min(1).max(25),
    topicId: z.string().trim().min(1).max(160),
    topicName: z.string().trim().min(1).max(160),
  })
  .strict();

const PresentTopicListSchema = z
  .object({
    type: z.literal('PRESENT_TOPIC_LIST'),
    subjectCatalogEntryId: z.string().trim().min(1).max(160),
    subjectDisplayName: z.string().trim().min(1).max(160),
    source: z.enum(['MANUAL', 'OPENAI_GENERATED']),
    topics: z.array(TopicSchema).length(25),
    chunks: z
      .array(
        z
          .object({
            sequence: z.number().int().min(1),
            text: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .min(1),
    messageDraft: DraftSchema,
  })
  .strict()
  .superRefine((action, context) => {
    action.topics.forEach((topic, index) => {
      if (topic.position !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['topics', index, 'position'],
          message: 'Topic positions must be contiguous from 1 to 25',
        });
      }
    });
    action.chunks.forEach((chunk, index) => {
      if (chunk.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['chunks', index, 'sequence'],
          message: 'Chunk sequences must be contiguous from 1',
        });
      }
    });
  });

const AskTopicSelectionSchema = z
  .object({
    type: z.literal('ASK_TOPIC_SELECTION'),
    subjectNames: z.array(z.string().trim().min(1).max(160)).min(1).max(5),
    messageDraft: DraftSchema,
  })
  .strict();

const ConfirmSelectedTopicsSchema = z
  .object({
    type: z.literal('CONFIRM_SELECTED_TOPICS'),
    topicNames: z.array(z.string().trim().min(1).max(160)).min(1).max(75),
    messageDraft: DraftSchema,
  })
  .strict();

const AskProductTypeSchema = z
  .object({
    type: z.literal('ASK_PRODUCT_TYPE'),
    allowedProductTypes: z.array(ProductTypeSchema).min(1),
    topicNames: z.array(z.string().trim().min(1).max(160)).min(1).max(75),
    messageDraft: DraftSchema,
  })
  .strict();

const AskIssuerVariantSchema = z
  .object({
    type: z.literal('ASK_ISSUER_VARIANT'),
    configurationPending: z.literal(true),
    messageDraft: DraftSchema,
  })
  .strict();

const AskFullNameSchema = z
  .object({ type: z.literal('ASK_FULL_NAME'), messageDraft: DraftSchema })
  .strict();

const ConfirmFullNameSchema = z
  .object({
    type: z.literal('CONFIRM_FULL_NAME'),
    fullName: z.string().trim().min(2).max(200),
    messageDraft: DraftSchema,
  })
  .strict();

const AskOrderConfirmationSchema = z
  .object({
    type: z.literal('ASK_ORDER_CONFIRMATION'),
    topicNames: z.array(z.string().trim().min(1).max(160)).min(1).max(75),
    messageDraft: DraftSchema,
  })
  .strict();

const RequestHumanTakeoverSchema = z
  .object({
    type: z.literal('REQUEST_HUMAN_TAKEOVER'),
    reason: z.string().trim().min(1).max(80),
    messageDraft: DraftSchema,
  })
  .strict();

export const IpdeDeferredIntentSchema = z.enum([
  'PRICE',
  'DISCOUNT',
  'PROMOTION',
  'MODEL_PDF',
  'PAYMENT_METHODS',
  'PAYMENT_PROOF_MENTION',
]);

const DeferredCommercialRequestSchema = z
  .object({
    type: z.literal('DEFERRED_COMMERCIAL_REQUEST'),
    intents: z.array(IpdeDeferredIntentSchema).min(1),
    reason: z.literal('OUT_OF_SCOPE_FOR_BLOCK_5'),
  })
  .strict();

export const IpdeOutboundActionSchema = z.discriminatedUnion('type', [
  NoAutomatedResponseSchema,
  AskSubjectOrDirectTopicsSchema,
  AskSubjectSchema,
  AskClarificationSchema,
  PresentTopicListSchema,
  AskTopicSelectionSchema,
  ConfirmSelectedTopicsSchema,
  AskProductTypeSchema,
  AskIssuerVariantSchema,
  AskFullNameSchema,
  ConfirmFullNameSchema,
  AskOrderConfirmationSchema,
  RequestHumanTakeoverSchema,
  DeferredCommercialRequestSchema,
]);

export const IpdeOutboundActionsSchema = z
  .array(IpdeOutboundActionSchema)
  .max(8);

export type IpdeDeferredIntent = z.infer<typeof IpdeDeferredIntentSchema>;
export type IpdeOutboundAction = z.infer<typeof IpdeOutboundActionSchema>;
