import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderStatus,
} from '@prisma/client';
import { z } from 'zod';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import {
  IpdeDeferredIntentSchema,
  IpdeOutboundActionsSchema,
} from './ipde-conversation-action.schemas';

const IdSchema = z.string().trim().min(1).max(160);

export const IpdeConversationTurnInputSchema = z
  .object({
    tenantCode: z.literal(IPDE_TENANT_CODE),
    tenantId: IdSchema,
    leadId: IdSchema,
    conversationId: IdSchema,
    turnId: IdSchema,
    userMessage: z.string().trim().min(1).max(4000),
    recentMessages: z
      .array(
        z
          .object({
            role: z.enum(['USER', 'ASSISTANT']),
            content: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();

const AppliedChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('STATE_CREATED'), stateId: IdSchema }).strict(),
  z.object({ type: z.literal('ORDER_CREATED'), orderId: IdSchema }).strict(),
  z
    .object({ type: z.literal('SUBJECT_ADDED'), subjectRequestId: IdSchema })
    .strict(),
  z
    .object({
      type: z.literal('SUBJECT_LIST_PRESENTED'),
      subjectRequestId: IdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('SUBJECT_SELECTION_COMPLETED'),
      subjectRequestId: IdSchema,
    })
    .strict(),
  z
    .object({ type: z.literal('ORDER_ITEM_ADDED'), orderItemId: IdSchema })
    .strict(),
  z
    .object({ type: z.literal('ORDER_ITEM_RESTORED'), orderItemId: IdSchema })
    .strict(),
  z
    .object({ type: z.literal('PRODUCT_TYPE_SET'), orderItemId: IdSchema })
    .strict(),
  z
    .object({ type: z.literal('ISSUER_SELECTION_SET'), orderItemId: IdSchema })
    .strict(),
  z.object({ type: z.literal('FULL_NAME_SET'), orderId: IdSchema }).strict(),
  z
    .object({ type: z.literal('FULL_NAME_CONFIRMED'), orderId: IdSchema })
    .strict(),
  z.object({ type: z.literal('QUOTE_SET'), orderId: IdSchema }).strict(),
  z
    .object({
      type: z.literal('STAGE_TRANSITIONED'),
      from: z.enum(IpdeConversationStage),
      to: z.enum(IpdeConversationStage),
    })
    .strict(),
  z
    .object({ type: z.literal('AUTOMATION_PAUSED'), stateId: IdSchema })
    .strict(),
  z.object({ type: z.literal('NO_CHANGE') }).strict(),
]);

export const IpdeConversationTurnResultSchema = z
  .object({
    turnId: IdSchema,
    state: z
      .object({
        stageBefore: z.enum(IpdeConversationStage),
        stageAfter: z.enum(IpdeConversationStage),
        automationMode: z.enum(IpdeAutomationMode),
        versionBefore: z.number().int().positive(),
        versionAfter: z.number().int().positive(),
      })
      .strict(),
    order: z
      .object({
        orderId: IdSchema.nullable(),
        status: z.enum(IpdeOrderStatus).nullable(),
        createdDuringTurn: z.boolean(),
      })
      .strict(),
    understanding: z
      .object({
        primaryIntent: z.string().trim().min(1).max(80),
        requestPath: z.enum(['DIRECT_TOPICS', 'CATALOG_LIST', 'UNDETERMINED']),
        subjectCount: z.number().int().nonnegative(),
        topicSelectionCount: z.number().int().nonnegative(),
        needsClarification: z.boolean(),
      })
      .strict()
      .nullable(),
    catalogResolution: z
      .object({
        route: z.enum([
          'DIRECT_TOPICS',
          'CATALOG_LISTS_READY',
          'NEEDS_CLARIFICATION',
          'NO_ACTION',
        ]),
        resolvedSubjectCount: z.number().int().nonnegative(),
        directTopicCount: z.number().int().nonnegative(),
        numericTopicCount: z.number().int().nonnegative(),
        generatedNow: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    appliedChanges: z.array(AppliedChangeSchema).min(1).max(200),
    outboundActions: IpdeOutboundActionsSchema,
    deferredIntents: z.array(IpdeDeferredIntentSchema),
    metadata: z
      .object({
        openAiCalls: z.number().int().nonnegative(),
        tokensInput: z.number().int().nonnegative(),
        tokensOutput: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
        usedFallback: z.boolean(),
        concurrentRetryCount: z.number().int().min(0).max(2),
      })
      .strict(),
  })
  .strict();

export type IpdeConversationTurnInput = z.infer<
  typeof IpdeConversationTurnInputSchema
>;
export type IpdeConversationTurnResult = z.infer<
  typeof IpdeConversationTurnResultSchema
>;
export type IpdeAppliedChange = z.infer<typeof AppliedChangeSchema>;
