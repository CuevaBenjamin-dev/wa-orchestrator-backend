import { z } from 'zod';
import {
  CommercialCategorySchema,
  SubjectCatalogEntrySchema,
} from '../../catalog/domain/catalog.schemas';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { IpdeMessageExtractionSchema } from '../understanding/ipde-understanding.schemas';

const ShortTextSchema = z.string().trim().min(1).max(160);
const OptionalIdSchema = z.string().trim().min(1).max(160).optional();

export const IpdePresentedTopicSchema = z
  .object({
    position: z.number().int().min(1).max(25),
    topicId: OptionalIdSchema,
    topicName: ShortTextSchema,
  })
  .strict();

export const IpdePresentedTopicListSchema = z
  .object({
    subjectDisplayName: ShortTextSchema,
    subjectCatalogEntryId: OptionalIdSchema,
    topics: z.array(IpdePresentedTopicSchema).min(1).max(25),
  })
  .strict()
  .superRefine((list, context) => {
    const positions = new Set<number>();
    list.topics.forEach((topic, index) => {
      if (positions.has(topic.position)) {
        context.addIssue({
          code: 'custom',
          path: ['topics', index, 'position'],
          message: 'Presented topic positions must be unique',
        });
      }
      positions.add(topic.position);
    });
  });

export const IpdeCatalogResolutionInputSchema = z
  .object({
    tenantCode: z.literal(IPDE_TENANT_CODE),
    extraction: IpdeMessageExtractionSchema,
    presentedTopicLists: z
      .array(IpdePresentedTopicListSchema)
      .max(3)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.extraction.subjects.length > 5) {
      context.addIssue({
        code: 'custom',
        path: ['extraction', 'subjects'],
        message: 'A resolution accepts at most five subjects',
      });
    }
  });

const SubjectResolutionSchema = z
  .object({
    rawText: ShortTextSchema,
    requestedDisplayName: ShortTextSchema,
    normalizedQuery: ShortTextSchema,
    category: CommercialCategorySchema.nullable(),
    resolutionStatus: z.enum([
      'FOUND_MANUAL',
      'FOUND_GENERATED',
      'GENERATED_AND_SAVED',
      'AMBIGUOUS',
      'FAILED',
    ]),
    catalogEntry: SubjectCatalogEntrySchema.nullable(),
    matchedBy: z
      .enum(['DISPLAY_NAME', 'NORMALIZED_NAME', 'ALIAS', 'FUZZY', 'GENERATED'])
      .nullable(),
    clarificationCandidates: z.array(ShortTextSchema).max(10),
    errorCode: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

const DirectTopicSchema = z
  .object({
    rawText: z.string().trim().min(1).max(500),
    topicName: ShortTextSchema,
    normalizedTopicName: ShortTextSchema,
    subjectReference: ShortTextSchema.nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const ResolvedNumericSelectionSchema = z
  .object({
    subjectDisplayName: ShortTextSchema,
    selectedTopics: z
      .array(
        IpdePresentedTopicSchema.extend({
          topicId: z.string().trim().min(1).max(160).nullable(),
        }).strict(),
      )
      .max(25),
  })
  .strict();

const UnresolvedSelectionSchema = z
  .object({
    rawText: z.string().trim().min(1).max(500),
    reason: z.enum([
      'NO_PRESENTED_LIST',
      'UNKNOWN_SUBJECT_REFERENCE',
      'POSITION_NOT_AVAILABLE',
      'AMBIGUOUS_SELECTION',
    ]),
  })
  .strict();

const ResolutionMetadataSchema = z
  .object({
    manualMatches: z.number().int().nonnegative(),
    generatedMatches: z.number().int().nonnegative(),
    generatedNow: z.number().int().nonnegative(),
    openAiCalls: z.number().int().nonnegative(),
    tokensInput: z.number().int().nonnegative(),
    tokensOutput: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  })
  .strict();

export const IpdeCatalogResolutionResultSchema = z
  .object({
    route: z.enum([
      'DIRECT_TOPICS',
      'CATALOG_LISTS_READY',
      'NEEDS_CLARIFICATION',
      'NO_ACTION',
    ]),
    subjects: z.array(SubjectResolutionSchema).max(5),
    directTopics: z.array(DirectTopicSchema).max(500),
    resolvedNumericSelections: z.array(ResolvedNumericSelectionSchema).max(20),
    unresolvedSelections: z.array(UnresolvedSelectionSchema).max(20),
    metadata: ResolutionMetadataSchema,
  })
  .strict();
