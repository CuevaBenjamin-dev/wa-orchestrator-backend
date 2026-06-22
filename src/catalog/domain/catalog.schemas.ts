import { z } from 'zod';
import {
  CATALOG_SOURCES,
  COMMERCIAL_CATEGORIES,
  IPDE_TENANT_CODE,
  PRODUCT_TYPES,
} from './catalog.types';
import { normalizeCatalogText } from '../utils/normalize-catalog-text';

const STABLE_ID = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
const ISO_DATE_TIME = z.iso.datetime({ offset: true });

export const CommercialCategorySchema = z.enum(COMMERCIAL_CATEGORIES);
export const ProductTypeSchema = z.enum(PRODUCT_TYPES);

function normalizedDuplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    const normalized = normalizeCatalogText(value);
    if (seen.has(normalized)) {
      duplicates.add(normalized);
    }
    seen.add(normalized);
  }

  return duplicates;
}

export const TopicSchema = z
  .object({
    id: z.string().regex(STABLE_ID),
    name: z.string().trim().min(3).max(160),
    aliases: z.array(z.string().trim().min(1).max(160)).optional().default([]),
    active: z.boolean(),
    priority: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((topic, context) => {
    const duplicateAliases = normalizedDuplicates(topic.aliases);
    for (const duplicate of duplicateAliases) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: `Duplicate normalized alias: ${duplicate}`,
      });
    }

    const normalizedName = normalizeCatalogText(topic.name);
    if (
      topic.aliases.some(
        (alias) => normalizeCatalogText(alias) === normalizedName,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: 'A topic alias cannot duplicate its normalized name',
      });
    }
  });

const GenerationMetadataSchema = z
  .object({
    model: z.string().trim().min(1).optional(),
    generatedAt: ISO_DATE_TIME.optional(),
    promptVersion: z.string().trim().min(1).optional(),
  })
  .strict();

const UsageMetadataSchema = z
  .object({
    useCount: z.number().int().nonnegative(),
    lastUsedAt: ISO_DATE_TIME.optional(),
  })
  .strict();

export const SubjectCatalogEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(STABLE_ID),
    tenantCode: z.literal(IPDE_TENANT_CODE),
    category: CommercialCategorySchema,
    displayName: z.string().trim().min(3).max(160),
    normalizedName: z.string().trim().min(1).max(160),
    aliases: z.array(z.string().trim().min(1).max(160)),
    allowedProductTypes: z.array(ProductTypeSchema).min(1),
    topics: z.array(TopicSchema).length(25),
    source: z.enum(CATALOG_SOURCES),
    active: z.boolean(),
    version: z.number().int().min(1),
    createdAt: ISO_DATE_TIME.optional(),
    updatedAt: ISO_DATE_TIME.optional(),
    generationMetadata: GenerationMetadataSchema.optional(),
    usageMetadata: UsageMetadataSchema.optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    const expectedNormalizedName = normalizeCatalogText(entry.displayName);
    if (entry.normalizedName !== expectedNormalizedName) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedName'],
        message: `Expected official normalized name: ${expectedNormalizedName}`,
      });
    }

    const activeTopics = entry.topics.filter((topic) => topic.active).length;
    if (activeTopics !== 25) {
      context.addIssue({
        code: 'custom',
        path: ['topics'],
        message: `Expected exactly 25 active topics, received ${activeTopics}`,
      });
    }

    if (
      new Set(entry.allowedProductTypes).size !==
      entry.allowedProductTypes.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['allowedProductTypes'],
        message: 'Product types must be unique',
      });
    }

    const normalizedAliases = entry.aliases.map(normalizeCatalogText);
    const duplicateAliases = normalizedDuplicates(entry.aliases);
    for (const duplicate of duplicateAliases) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: `Duplicate normalized alias: ${duplicate}`,
      });
    }
    if (normalizedAliases.includes(expectedNormalizedName)) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: 'A subject alias cannot duplicate its normalized name',
      });
    }

    const topicIds = new Set<string>();
    const topicNames = new Set<string>();
    const topicAliases = new Set<string>();

    entry.topics.forEach((topic, topicIndex) => {
      if (topicIds.has(topic.id)) {
        context.addIssue({
          code: 'custom',
          path: ['topics', topicIndex, 'id'],
          message: `Duplicate topic id: ${topic.id}`,
        });
      }
      topicIds.add(topic.id);

      const topicName = normalizeCatalogText(topic.name);
      if (topicNames.has(topicName)) {
        context.addIssue({
          code: 'custom',
          path: ['topics', topicIndex, 'name'],
          message: `Duplicate normalized topic name: ${topicName}`,
        });
      }
      topicNames.add(topicName);

      for (const alias of topic.aliases) {
        const normalizedAlias = normalizeCatalogText(alias);
        if (topicAliases.has(normalizedAlias)) {
          context.addIssue({
            code: 'custom',
            path: ['topics', topicIndex, 'aliases'],
            message: `Duplicate topic alias in entry: ${normalizedAlias}`,
          });
        }
        topicAliases.add(normalizedAlias);
      }
    });

    for (const alias of topicAliases) {
      if (topicNames.has(alias)) {
        context.addIssue({
          code: 'custom',
          path: ['topics'],
          message: `A topic alias cannot duplicate a topic name: ${alias}`,
        });
      }
    }
  });

export const ManualSubjectCatalogEntrySchema = SubjectCatalogEntrySchema.refine(
  (entry) => entry.source === 'MANUAL',
  {
    path: ['source'],
    message: 'Manual catalog entries must use source MANUAL',
  },
);

export const GeneratedSubjectCatalogEntrySchema =
  SubjectCatalogEntrySchema.refine(
    (entry) => entry.source === 'OPENAI_GENERATED',
    {
      path: ['source'],
      message: 'Generated catalog entries must use source OPENAI_GENERATED',
    },
  );

export const ManualCatalogFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenantCode: z.literal(IPDE_TENANT_CODE),
    subjects: z.array(ManualSubjectCatalogEntrySchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    const searchKeys = new Set<string>();

    catalog.subjects.forEach((subject, subjectIndex) => {
      if (ids.has(subject.id)) {
        context.addIssue({
          code: 'custom',
          path: ['subjects', subjectIndex, 'id'],
          message: `Duplicate subject id: ${subject.id}`,
        });
      }
      ids.add(subject.id);

      const keys = new Set(
        [subject.displayName, subject.normalizedName, ...subject.aliases].map(
          normalizeCatalogText,
        ),
      );
      for (const key of keys) {
        if (searchKeys.has(key)) {
          context.addIssue({
            code: 'custom',
            path: ['subjects', subjectIndex],
            message: `Duplicate subject name or alias: ${key}`,
          });
        }
        searchKeys.add(key);
      }
    });
  });

export function formatZodIssues(error: z.ZodError): Array<{
  path: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '<root>',
    message: issue.message,
  }));
}
