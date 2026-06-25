import { z } from 'zod';
import { ProductTypeSchema } from '../../catalog/domain/catalog.schemas';

const DraftSchema = z.string().trim().min(1).max(20_000);
const ShortTextSchema = z.string().trim().min(1).max(500);
const MoneyAmountSchema = z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/);

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

const IssuerOptionSchema = z
  .object({
    issuerCode: z.string().trim().min(1).max(80),
    issuerName: z.string().trim().min(1).max(200),
    variantCode: z.string().trim().min(1).max(80),
    variantName: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500),
    recommended: z.boolean(),
  })
  .strict();

const AskIssuerVariantSchema = z
  .object({
    type: z.literal('ASK_ISSUER_VARIANT'),
    configurationPending: z.boolean(),
    recommended: IssuerOptionSchema.omit({ recommended: true }).optional(),
    options: z.array(IssuerOptionSchema).min(1).max(10).optional(),
    messageDraft: DraftSchema,
  })
  .strict()
  .superRefine((action, context) => {
    if (
      action.configurationPending === false &&
      (!action.recommended || !action.options)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Configured issuer action requires recommendation and options',
      });
    }
    if (
      action.configurationPending === true &&
      (action.recommended || action.options)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending issuer action cannot expose configured options',
      });
    }
    if (
      action.configurationPending === false &&
      action.recommended &&
      action.options
    ) {
      const optionKeys = action.options.map(
        (option) => `${option.issuerCode}:${option.variantCode}`,
      );
      if (new Set(optionKeys).size !== optionKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Configured issuer options must be unique',
        });
      }
      const recommendedOptions = action.options.filter(
        (option) => option.recommended,
      );
      if (
        recommendedOptions.length !== 1 ||
        recommendedOptions[0].issuerCode !== action.recommended.issuerCode ||
        recommendedOptions[0].variantCode !== action.recommended.variantCode
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recommended'],
          message: 'Recommendation must match exactly one configured option',
        });
      }
    }
  });

const OfferModelPdfOptionsSchema = z
  .object({
    type: z.literal('OFFER_MODEL_PDF_OPTIONS'),
    modelPdfAssets: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(160),
            title: z.string().trim().min(1).max(200),
            description: z.string().trim().min(1).max(500),
            issuerCode: z.string().trim().min(1).max(80),
            issuerVariantCode: z.string().trim().min(1).max(80),
            productTypeCode: ProductTypeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(30),
    messageDraft: DraftSchema,
  })
  .strict()
  .superRefine((action, context) => {
    const ids = action.modelPdfAssets.map((asset) => asset.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['modelPdfAssets'],
        message: 'Model PDF options must be unique',
      });
    }
  });

const QuotePriceSchema = z
  .object({
    type: z.literal('QUOTE_PRICE'),
    currencyCode: z.literal('PEN'),
    totalRegularAmount: MoneyAmountSchema,
    totalPromotionalAmount: MoneyAmountSchema,
    promotionLabel: z.string().trim().min(1).max(500).nullable(),
    appliedRuleIds: z.array(z.string().trim().min(1).max(160)).min(1).max(75),
    messageDraft: DraftSchema,
  })
  .strict()
  .superRefine((action, context) => {
    if (new Set(action.appliedRuleIds).size !== action.appliedRuleIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['appliedRuleIds'],
        message: 'Applied pricing rule IDs must be unique',
      });
    }
  });

const QuoteDiscountSchema = z
  .object({
    type: z.literal('QUOTE_DISCOUNT'),
    currencyCode: z.literal('PEN'),
    currentAmount: MoneyAmountSchema,
    discountedAmount: MoneyAmountSchema,
    discountAvailable: z.boolean(),
    messageDraft: DraftSchema,
  })
  .strict();

const PriceNotAvailableSchema = z
  .object({
    type: z.literal('PRICE_NOT_AVAILABLE'),
    reason: z.enum([
      'MISSING_TOPICS',
      'MISSING_PRODUCT',
      'MISSING_ISSUER',
      'NO_PRICING_RULE',
      'PARTIAL_PRICING',
    ]),
    messageDraft: DraftSchema,
  })
  .strict();

const SendPromotionImageSchema = z
  .object({
    type: z.literal('SEND_PROMOTION_IMAGE'),
    assetId: z.string().trim().min(1).max(160),
    categoryCode: z.string().trim().min(1).max(80).nullable(),
    messageDraft: DraftSchema,
  })
  .strict();

const SendPaymentMethodsImageSchema = z
  .object({
    type: z.literal('SEND_PAYMENT_METHODS_IMAGE'),
    assetId: z.string().trim().min(1).max(160),
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

const PaymentProofReceivedSchema = z
  .object({
    type: z.literal('PAYMENT_PROOF_RECEIVED'),
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
    reason: z.enum([
      'OUT_OF_SCOPE_FOR_BLOCK_5',
      'MEDIA_NOT_CONFIGURED',
      'PAYMENT_METHODS_NOT_CONFIGURED',
    ]),
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
  OfferModelPdfOptionsSchema,
  QuotePriceSchema,
  QuoteDiscountSchema,
  PriceNotAvailableSchema,
  SendPromotionImageSchema,
  SendPaymentMethodsImageSchema,
  AskFullNameSchema,
  ConfirmFullNameSchema,
  AskOrderConfirmationSchema,
  RequestHumanTakeoverSchema,
  PaymentProofReceivedSchema,
  DeferredCommercialRequestSchema,
]);

export const IpdeOutboundActionsSchema = z
  .array(IpdeOutboundActionSchema)
  .max(8);

export type IpdeDeferredIntent = z.infer<typeof IpdeDeferredIntentSchema>;
export type IpdeOutboundAction = z.infer<typeof IpdeOutboundActionSchema>;
