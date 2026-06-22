import { CatalogService } from '../../catalog/catalog.service';
import {
  CatalogMatch,
  CommercialCategory,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import { IpdeSubjectGenerationUnavailableError } from './ipde-catalog-resolution.errors';
import { IpdeCatalogResolutionService } from './ipde-catalog-resolution.service';
import { IpdeFuzzyCatalogMatchService } from './ipde-fuzzy-catalog-match.service';
import { IpdeGenerationLockService } from './ipde-generation-lock.service';
import { IpdeSubjectListGenerationService } from './ipde-subject-list-generation.service';
import { IpdeTopicSelectionResolutionService } from './ipde-topic-selection-resolution.service';

function catalogEntry(
  displayName: string,
  source: 'MANUAL' | 'OPENAI_GENERATED' = 'MANUAL',
  category: CommercialCategory = 'OTROS',
): SubjectCatalogEntry {
  const normalizedName = normalizeCatalogText(displayName);
  const id = `${source === 'MANUAL' ? 'MAN' : 'GEN'}_${normalizedName
    .replace(/ /g, '_')
    .toUpperCase()}`;
  return {
    schemaVersion: 1,
    id,
    tenantCode: 'IPDE',
    category,
    displayName,
    normalizedName,
    aliases: [],
    allowedProductTypes: ['CURSO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `${id}_TOPIC_${String(index + 1).padStart(2, '0')}`,
      name: `Contenido de catálogo ${String(index + 1).padStart(2, '0')}`,
      aliases: [],
      active: true,
      priority: index + 1,
    })),
    source,
    active: true,
    version: 1,
    ...(source === 'OPENAI_GENERATED'
      ? { usageMetadata: { useCount: 1 } }
      : {}),
  };
}

function extraction(params?: {
  requestPath?: IpdeMessageExtraction['requestPath'];
  subjects?: IpdeMessageExtraction['subjects'];
  topicSelections?: IpdeMessageExtraction['topicSelections'];
  needsClarification?: boolean;
}): IpdeMessageExtraction {
  return {
    schemaVersion: 1,
    primaryIntent: 'PROVIDE_SUBJECTS',
    secondaryIntents: [],
    requestPath: params?.requestPath ?? 'CATALOG_LIST',
    subjects: params?.subjects ?? [
      {
        rawText: 'Derecho Civil',
        displayNameCandidate: 'Derecho Civil',
        normalizedNameCandidate: 'derecho civil',
        categoryCandidate: 'DERECHO',
        confidence: 0.95,
        isAcronym: false,
        needsClarification: false,
      },
    ],
    topicSelections: params?.topicSelections ?? [],
    productSelections: [],
    issuerPreference: {
      issuerCode: 'UNSPECIFIED',
      variantCode: 'UNSPECIFIED',
      confidence: 0,
    },
    fullNameCandidate: null,
    requestedArtifacts: [],
    commercialSignals: {
      asksForPrice: false,
      asksForDiscount: false,
      appearsReadyToBuy: false,
      wantsHuman: false,
      mentionsPaymentProof: false,
    },
    confirmation: 'UNCLEAR',
    needsClarification: params?.needsClarification ?? false,
    ambiguities: [],
    overallConfidence: 0.95,
  };
}

function subject(displayName: string, category: CommercialCategory = 'OTROS') {
  return {
    rawText: displayName,
    displayNameCandidate: displayName,
    normalizedNameCandidate: normalizeCatalogText(displayName),
    categoryCandidate: category,
    confidence: 0.9,
    isAcronym: false,
    needsClarification: false,
  };
}

function match(
  entry: SubjectCatalogEntry,
  matchedBy: CatalogMatch['matchedBy'] = 'NORMALIZED_NAME',
): CatalogMatch {
  return {
    entry,
    source: entry.source,
    matchedBy,
    matchedValue: entry.normalizedName,
  };
}

function createHarness(params?: {
  findExact?: (query: string) => Promise<CatalogMatch | null>;
  listAll?: () => Promise<SubjectCatalogEntry[]>;
  saveGenerated?: (entry: SubjectCatalogEntry) => Promise<SubjectCatalogEntry>;
  recordGeneratedUse?: (entryId: string) => Promise<SubjectCatalogEntry | null>;
  generate?: (
    displayName: string,
    category: CommercialCategory | null,
  ) => Promise<SubjectCatalogEntry>;
}) {
  const findExact = jest.fn((input: { tenantCode: string; query: string }) =>
    params?.findExact
      ? params.findExact(input.query)
      : Promise.resolve<CatalogMatch | null>(null),
  );
  const listAll = jest.fn(() =>
    params?.listAll ? params.listAll() : Promise.resolve([]),
  );
  const saveGenerated = jest.fn((entry: SubjectCatalogEntry) =>
    params?.saveGenerated
      ? params.saveGenerated(entry)
      : Promise.resolve(entry),
  );
  const recordGeneratedUse = jest.fn(
    (input: { tenantCode: string; id: string }) =>
      params?.recordGeneratedUse
        ? params.recordGeneratedUse(input.id)
        : Promise.resolve<SubjectCatalogEntry | null>(null),
  );
  const catalog = {
    findExact,
    listAll,
    saveGenerated,
    recordGeneratedUse,
  } as unknown as CatalogService;

  const generate = jest.fn(
    async (input: {
      requestedDisplayName: string;
      categoryCandidate: CommercialCategory | null;
    }) => ({
      entry: params?.generate
        ? await params.generate(
            input.requestedDisplayName,
            input.categoryCandidate,
          )
        : catalogEntry(
            input.requestedDisplayName,
            'OPENAI_GENERATED',
            input.categoryCandidate ?? 'OTROS',
          ),
      diagnostics: {
        openAiCalls: 1,
        tokensInput: 100,
        tokensOutput: 200,
        latencyMs: 5,
      },
    }),
  );
  const generator = { generate } as unknown as IpdeSubjectListGenerationService;

  return {
    findExact,
    listAll,
    saveGenerated,
    recordGeneratedUse,
    generate,
    service: new IpdeCatalogResolutionService(
      catalog,
      new IpdeFuzzyCatalogMatchService(),
      generator,
      new IpdeGenerationLockService(),
      new IpdeTopicSelectionResolutionService(),
    ),
  };
}

describe('IpdeCatalogResolutionService', () => {
  it('resolves a manual subject without OpenAI', async () => {
    const manual = catalogEntry('Derecho Civil', 'MANUAL', 'DERECHO');
    const harness = createHarness({
      findExact: () => Promise.resolve(match(manual)),
    });
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction(),
    });

    expect(result.route).toBe('CATALOG_LISTS_READY');
    expect(result.subjects[0]).toMatchObject({
      resolutionStatus: 'FOUND_MANUAL',
      matchedBy: 'NORMALIZED_NAME',
    });
    expect(result.metadata.manualMatches).toBe(1);
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('resolves a manual alias without OpenAI', async () => {
    const manual = catalogEntry('Derecho Civil', 'MANUAL', 'DERECHO');
    const harness = createHarness({
      findExact: () => Promise.resolve(match(manual, 'ALIAS')),
    });
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction(),
    });
    expect(result.subjects[0].matchedBy).toBe('ALIAS');
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('reuses a generated entry and records its use without OpenAI', async () => {
    const generated = catalogEntry('Andrología', 'OPENAI_GENERATED', 'SALUD');
    const harness = createHarness({
      findExact: () => Promise.resolve(match(generated)),
      recordGeneratedUse: () =>
        Promise.resolve({
          ...generated,
          usageMetadata: { useCount: 2 },
        }),
    });
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({ subjects: [subject('Andrología', 'SALUD')] }),
    });
    expect(result.subjects[0]).toMatchObject({
      resolutionStatus: 'FOUND_GENERATED',
      catalogEntry: { usageMetadata: { useCount: 2 } },
    });
    expect(result.metadata.generatedMatches).toBe(1);
    expect(harness.recordGeneratedUse).toHaveBeenCalledTimes(1);
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('generates and saves an unknown subject', async () => {
    const harness = createHarness();
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({ subjects: [subject('Andrología', 'SALUD')] }),
    });
    expect(result.subjects[0].resolutionStatus).toBe('GENERATED_AND_SAVED');
    expect(result.metadata).toMatchObject({
      generatedNow: 1,
      openAiCalls: 1,
      tokensInput: 100,
      tokensOutput: 200,
    });
    expect(harness.saveGenerated).toHaveBeenCalledTimes(1);
  });

  it('keeps successful subjects when another generation fails', async () => {
    const manual = catalogEntry('Derecho Civil', 'MANUAL', 'DERECHO');
    const harness = createHarness({
      findExact: (query) =>
        Promise.resolve(query === 'Derecho Civil' ? match(manual) : null),
      generate: (displayName) =>
        displayName === 'Andrología'
          ? Promise.reject(
              new IpdeSubjectGenerationUnavailableError('TIMEOUT', {
                openAiCalls: 1,
                tokensInput: 0,
                tokensOutput: 0,
                latencyMs: 5,
              }),
            )
          : Promise.resolve(catalogEntry(displayName, 'OPENAI_GENERATED')),
    });
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({
        subjects: [
          subject('Derecho Civil', 'DERECHO'),
          subject('Andrología', 'SALUD'),
        ],
      }),
    });
    expect(result.route).toBe('NEEDS_CLARIFICATION');
    expect(result.subjects.map((item) => item.resolutionStatus)).toEqual([
      'FOUND_MANUAL',
      'FAILED',
    ]);
    expect(result.metadata.openAiCalls).toBe(1);
  });

  it('does not generate for UNDETERMINED or an ambiguous acronym', async () => {
    const undeterminedHarness = createHarness();
    const undetermined = await undeterminedHarness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({
        requestPath: 'UNDETERMINED',
        subjects: [],
        needsClarification: true,
      }),
    });
    expect(undetermined.route).toBe('NEEDS_CLARIFICATION');
    expect(undeterminedHarness.generate).not.toHaveBeenCalled();

    const acronymHarness = createHarness();
    const acronym = subject('IVA');
    acronym.isAcronym = true;
    acronym.needsClarification = true;
    const acronymResult = await acronymHarness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({ subjects: [acronym] }),
    });
    expect(acronymResult.subjects[0]).toMatchObject({
      resolutionStatus: 'AMBIGUOUS',
      errorCode: 'AMBIGUOUS_ACRONYM',
    });
    expect(acronymHarness.generate).not.toHaveBeenCalled();
  });

  it('returns direct written topics without consulting the catalog', async () => {
    const harness = createHarness();
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({
        requestPath: 'DIRECT_TOPICS',
        subjects: [],
        topicSelections: [
          {
            rawText: 'Derecho de Familia',
            subjectReference: 'Derecho Civil',
            selectedNumbers: [],
            selectedNames: ['Derecho de Familia'],
            confidence: 0.95,
          },
          {
            rawText: 'derecho de familia',
            subjectReference: 'Derecho Civil',
            selectedNumbers: [],
            selectedNames: ['derecho de familia'],
            confidence: 0.95,
          },
        ],
      }),
    });
    expect(result.route).toBe('DIRECT_TOPICS');
    expect(result.directTopics).toEqual([
      expect.objectContaining({
        topicName: 'Derecho de Familia',
        normalizedTopicName: 'derecho de familia',
      }),
    ]);
    expect(harness.findExact).not.toHaveBeenCalled();
    expect(harness.listAll).not.toHaveBeenCalled();
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('performs one generation for concurrent requests of the same subject', async () => {
    let stored: SubjectCatalogEntry | null = null;
    const harness = createHarness({
      findExact: () => Promise.resolve(stored ? match(stored) : null),
      saveGenerated: (entry) => {
        stored = entry;
        return Promise.resolve(entry);
      },
      recordGeneratedUse: () => Promise.resolve(stored),
      generate: async (displayName, category) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return catalogEntry(
          displayName,
          'OPENAI_GENERATED',
          category ?? 'OTROS',
        );
      },
    });
    const input = {
      tenantCode: 'IPDE' as const,
      extraction: extraction({ subjects: [subject('Andrología', 'SALUD')] }),
    };

    const [first, second] = await Promise.all([
      harness.service.resolve(input),
      harness.service.resolve(input),
    ]);

    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect(first.subjects[0].catalogEntry?.id).toBe(
      second.subjects[0].catalogEntry?.id,
    );
    expect([
      first.subjects[0].resolutionStatus,
      second.subjects[0].resolutionStatus,
    ]).toEqual(
      expect.arrayContaining(['GENERATED_AND_SAVED', 'FOUND_GENERATED']),
    );
  });

  it('limits subject processing to three concurrent generations', async () => {
    let active = 0;
    let maximum = 0;
    const harness = createHarness({
      generate: async (displayName, category) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return catalogEntry(
          displayName,
          'OPENAI_GENERATED',
          category ?? 'OTROS',
        );
      },
    });
    await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({
        subjects: [
          subject('Materia Alfa'),
          subject('Materia Beta'),
          subject('Materia Gamma'),
          subject('Materia Delta'),
          subject('Materia Épsilon'),
        ],
      }),
    });
    expect(maximum).toBe(3);
  });

  it('returns a generated list even if usage metadata cannot be updated', async () => {
    const generated = catalogEntry('Andrología', 'OPENAI_GENERATED', 'SALUD');
    const harness = createHarness({
      findExact: () => Promise.resolve(match(generated)),
      recordGeneratedUse: () => Promise.reject(new Error('disk unavailable')),
    });
    const result = await harness.service.resolve({
      tenantCode: 'IPDE',
      extraction: extraction({ subjects: [subject('Andrología', 'SALUD')] }),
    });
    expect(result.subjects[0].resolutionStatus).toBe('FOUND_GENERATED');
    expect(result.subjects[0].catalogEntry?.id).toBe(generated.id);
  });
});
