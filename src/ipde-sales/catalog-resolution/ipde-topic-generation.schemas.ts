import { z } from 'zod';
import { CommercialCategorySchema } from '../../catalog/domain/catalog.schemas';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';

const FORBIDDEN_CONTENT =
  /\b(?:universidad|instituto|colegio|firma|sello|precio|costo|tarifa|promocion|oferta|descuento|soles?)\b/i;
const FORBIDDEN_OFFICIAL_RESOLUTION =
  /\bresolucion(?:\s+(?:n|numero|ministerial|rectoral|oficial|suprema|administrativa)|\s*\d)/i;
const EMOJI = /\p{Extended_Pictographic}/u;

export const GenerateIpdeSubjectEntryInputSchema = z
  .object({
    tenantCode: z.literal(IPDE_TENANT_CODE),
    requestedDisplayName: z.string().trim().min(3).max(160),
    normalizedName: z.string().trim().min(1).max(160),
    categoryCandidate: CommercialCategorySchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.normalizedName !== normalizeCatalogText(input.requestedDisplayName)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedName'],
        message: 'Subject name must use the official normalizer',
      });
    }
  });

const GeneratedTopicSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    aliases: z.array(z.string().trim().min(1).max(160)).max(5),
  })
  .strict()
  .superRefine((topic, context) => {
    const normalizedName = normalizeCatalogText(topic.name);
    const normalizedAliases = topic.aliases.map(normalizeCatalogText);

    if (/\d/u.test(topic.name) || /^tema(?:\s|$)/i.test(topic.name)) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Topic names cannot contain numbering or generic labels',
      });
    }
    if (
      FORBIDDEN_CONTENT.test(normalizeCatalogText(topic.name)) ||
      FORBIDDEN_OFFICIAL_RESOLUTION.test(normalizeCatalogText(topic.name))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message:
          'Topic name contains forbidden commercial or institutional content',
      });
    }
    if (EMOJI.test(topic.name)) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Topic names cannot contain emoji',
      });
    }
    if (new Set(normalizedAliases).size !== normalizedAliases.length) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: 'Topic aliases must be unique after normalization',
      });
    }
    if (normalizedAliases.includes(normalizedName)) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: 'A topic alias cannot duplicate its normalized name',
      });
    }
    topic.aliases.forEach((alias, index) => {
      if (
        /\d/u.test(alias) ||
        FORBIDDEN_CONTENT.test(normalizeCatalogText(alias)) ||
        FORBIDDEN_OFFICIAL_RESOLUTION.test(normalizeCatalogText(alias)) ||
        EMOJI.test(alias)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['aliases', index],
          message: 'Topic alias contains forbidden content',
        });
      }
    });
  });

export const GeneratedTopicListSchema = z
  .object({
    schemaVersion: z.literal(1),
    subjectDisplayName: z.string().trim().min(3).max(160),
    topics: z.array(GeneratedTopicSchema).length(25),
  })
  .strict()
  .superRefine((list, context) => {
    const names = list.topics.map((topic) => normalizeCatalogText(topic.name));
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['topics'],
        message: 'Topic names must be unique after normalization',
      });
    }

    const aliases = list.topics.flatMap((topic) =>
      topic.aliases.map(normalizeCatalogText),
    );
    if (new Set(aliases).size !== aliases.length) {
      context.addIssue({
        code: 'custom',
        path: ['topics'],
        message: 'Aliases must be unique across the generated list',
      });
    }
    const nameSet = new Set(names);
    if (aliases.some((alias) => nameSet.has(alias))) {
      context.addIssue({
        code: 'custom',
        path: ['topics'],
        message: 'An alias cannot duplicate any generated topic name',
      });
    }
  });
