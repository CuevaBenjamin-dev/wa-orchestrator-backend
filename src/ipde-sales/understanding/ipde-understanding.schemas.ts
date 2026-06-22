import { IpdeAutomationMode, IpdeConversationStage } from '@prisma/client';
import { z } from 'zod';
import {
  CommercialCategorySchema,
  ProductTypeSchema,
} from '../../catalog/domain/catalog.schemas';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import {
  IPDE_AMBIGUITY_CODES,
  IPDE_CONFIRMATION_VALUES,
  IPDE_CONTEXT_MESSAGE_ROLES,
  IPDE_INTENTS,
  IPDE_ISSUER_CODES,
  IPDE_ISSUER_VARIANT_CODES,
  IPDE_REQUEST_PATHS,
  IPDE_REQUESTED_ARTIFACTS,
} from './ipde-understanding.constants';

const ShortTextSchema = z.string().trim().min(1).max(160);
const OptionalIdSchema = z.string().trim().min(1).max(160).optional();

export const IpdeIntentSchema = z.enum(IPDE_INTENTS);
export const IpdeRequestPathSchema = z.enum(IPDE_REQUEST_PATHS);
export const IpdeRequestedArtifactSchema = z.enum(IPDE_REQUESTED_ARTIFACTS);

const RecentMessageSchema = z
  .object({
    role: z.enum(IPDE_CONTEXT_MESSAGE_ROLES),
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

const KnownSubjectSchema = z
  .object({
    id: OptionalIdSchema,
    displayName: ShortTextSchema,
    normalizedName: ShortTextSchema,
  })
  .strict();

const KnownTopicSchema = z
  .object({
    id: OptionalIdSchema,
    topicName: ShortTextSchema,
    subjectDisplayName: ShortTextSchema.optional(),
    productTypeCode: ShortTextSchema.optional(),
  })
  .strict();

const KnownOrderContextSchema = z
  .object({
    subjects: z.array(KnownSubjectSchema).max(20),
    selectedTopics: z.array(KnownTopicSchema).max(75),
    fullName: z.string().trim().min(2).max(200).optional(),
    issuerCode: ShortTextSchema.optional(),
    issuerVariantCode: ShortTextSchema.optional(),
  })
  .strict();

const PresentedTopicSchema = z
  .object({
    position: z.number().int().min(1).max(25),
    topicId: OptionalIdSchema,
    topicName: ShortTextSchema,
  })
  .strict();

const PresentedTopicListSchema = z
  .object({
    subjectDisplayName: ShortTextSchema,
    topics: z.array(PresentedTopicSchema).min(1).max(25),
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

export const IpdeMessageUnderstandingInputSchema = z
  .object({
    tenantCode: z.literal(IPDE_TENANT_CODE),
    userMessage: z.string().trim().min(1).max(4000),
    currentStage: z.enum(IpdeConversationStage).optional(),
    automationMode: z.enum(IpdeAutomationMode).optional(),
    recentMessages: z.array(RecentMessageSchema).max(6).optional(),
    knownOrderContext: KnownOrderContextSchema.optional(),
    presentedTopicLists: z.array(PresentedTopicListSchema).max(3).optional(),
  })
  .strict();

const SubjectExtractionSchema = z
  .object({
    rawText: ShortTextSchema,
    displayNameCandidate: ShortTextSchema,
    normalizedNameCandidate: ShortTextSchema,
    categoryCandidate: CommercialCategorySchema.nullable(),
    confidence: z.number().min(0).max(1),
    isAcronym: z.boolean(),
    needsClarification: z.boolean(),
  })
  .strict();

const TopicSelectionSchema = z
  .object({
    rawText: z.string().trim().min(1).max(500),
    subjectReference: ShortTextSchema.nullable(),
    selectedNumbers: z.array(z.number().int().min(1).max(25)).max(25),
    selectedNames: z.array(ShortTextSchema).max(25),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const ProductSelectionSchema = z
  .object({
    rawText: z.string().trim().min(1).max(500),
    productTypeCode: ProductTypeSchema,
    appliesTo: z.enum(['ALL', 'SUBJECT', 'TOPIC']),
    targetReference: ShortTextSchema.nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const IssuerPreferenceSchema = z
  .object({
    issuerCode: z.enum(IPDE_ISSUER_CODES),
    variantCode: z.enum(IPDE_ISSUER_VARIANT_CODES),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const CommercialSignalsSchema = z
  .object({
    asksForPrice: z.boolean(),
    asksForDiscount: z.boolean(),
    appearsReadyToBuy: z.boolean(),
    wantsHuman: z.boolean(),
    mentionsPaymentProof: z.boolean(),
  })
  .strict();

const AmbiguitySchema = z
  .object({
    code: z.enum(IPDE_AMBIGUITY_CODES),
    description: z.string().trim().min(1).max(500),
    candidateValues: z.array(ShortTextSchema).max(20),
  })
  .strict();

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeCatalogText(value);
    if (seen.has(normalized)) {
      return value;
    }
    seen.add(normalized);
  }
  return null;
}

export const IpdeMessageExtractionSchema = z
  .object({
    schemaVersion: z.literal(1),
    primaryIntent: IpdeIntentSchema,
    secondaryIntents: z.array(IpdeIntentSchema).max(IPDE_INTENTS.length - 1),
    requestPath: IpdeRequestPathSchema,
    subjects: z.array(SubjectExtractionSchema).max(20),
    topicSelections: z.array(TopicSelectionSchema).max(20),
    productSelections: z.array(ProductSelectionSchema).max(20),
    issuerPreference: IssuerPreferenceSchema,
    fullNameCandidate: z.string().trim().min(2).max(200).nullable(),
    requestedArtifacts: z.array(IpdeRequestedArtifactSchema).max(3),
    commercialSignals: CommercialSignalsSchema,
    confirmation: z.enum(IPDE_CONFIRMATION_VALUES),
    needsClarification: z.boolean(),
    ambiguities: z.array(AmbiguitySchema).max(20),
    overallConfidence: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((extraction, context) => {
    const uniqueSecondary = new Set(extraction.secondaryIntents);
    if (uniqueSecondary.size !== extraction.secondaryIntents.length) {
      context.addIssue({
        code: 'custom',
        path: ['secondaryIntents'],
        message: 'Secondary intents must be unique',
      });
    }
    if (uniqueSecondary.has(extraction.primaryIntent)) {
      context.addIssue({
        code: 'custom',
        path: ['secondaryIntents'],
        message: 'Primary intent cannot be repeated as a secondary intent',
      });
    }

    if (
      new Set(extraction.requestedArtifacts).size !==
      extraction.requestedArtifacts.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requestedArtifacts'],
        message: 'Requested artifacts must be unique',
      });
    }

    const duplicateSubject = findDuplicate(
      extraction.subjects.map((subject) => subject.normalizedNameCandidate),
    );
    if (duplicateSubject) {
      context.addIssue({
        code: 'custom',
        path: ['subjects'],
        message: `Subjects must be unique: ${duplicateSubject}`,
      });
    }
    extraction.subjects.forEach((subject, index) => {
      const expected = normalizeCatalogText(subject.displayNameCandidate);
      if (subject.normalizedNameCandidate !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['subjects', index, 'normalizedNameCandidate'],
          message: `Expected normalized subject name: ${expected}`,
        });
      }
    });

    extraction.topicSelections.forEach((selection, index) => {
      if (
        new Set(selection.selectedNumbers).size !==
        selection.selectedNumbers.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['topicSelections', index, 'selectedNumbers'],
          message: 'Selected topic numbers must be unique',
        });
      }
      const duplicateName = findDuplicate(selection.selectedNames);
      if (duplicateName) {
        context.addIssue({
          code: 'custom',
          path: ['topicSelections', index, 'selectedNames'],
          message: `Selected topic names must be unique: ${duplicateName}`,
        });
      }
    });

    const productKeys = extraction.productSelections.map(
      (selection) =>
        `${selection.productTypeCode}:${selection.appliesTo}:${normalizeCatalogText(selection.targetReference ?? '')}`,
    );
    if (new Set(productKeys).size !== productKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['productSelections'],
        message: 'Product selections must be unique',
      });
    }
  });
