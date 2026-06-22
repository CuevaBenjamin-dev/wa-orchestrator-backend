import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogService } from '../../catalog/catalog.service';
import {
  PRODUCT_TYPES,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { GeneratedCatalogRepository } from '../../catalog/repositories/generated-catalog.repository';
import { ManualCatalogRepository } from '../../catalog/repositories/manual-catalog.repository';
import { AtomicJsonFileService } from '../../catalog/storage/atomic-json-file.service';
import { CatalogPathsService } from '../../catalog/storage/catalog-paths.service';
import { PersistentStorageService } from '../../catalog/storage/persistent-storage.service';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import { IpdeCatalogResolutionService } from './ipde-catalog-resolution.service';
import { IpdeFuzzyCatalogMatchService } from './ipde-fuzzy-catalog-match.service';
import { IpdeGeneratedEntryIdService } from './ipde-generated-entry-id.service';
import { IpdeGenerationLockService } from './ipde-generation-lock.service';
import { IpdeSubjectListGenerationService } from './ipde-subject-list-generation.service';
import { IpdeTopicSelectionResolutionService } from './ipde-topic-selection-resolution.service';

function createCatalog(root: string): CatalogService {
  const config = new ConfigService({
    IPDE_TENANT_CODE: 'IPDE',
    IPDE_MANUAL_CATALOG_PATH: join(root, 'catalog.manual.json'),
    PERSISTENT_DATA_DIR: join(root, 'data'),
    IPDE_GENERATED_CATALOG_SUBDIR: 'generated-catalog',
  });
  const paths = new CatalogPathsService(config);
  const storage = new PersistentStorageService();
  const manual = new ManualCatalogRepository(paths, storage);
  const generated = new GeneratedCatalogRepository(
    paths,
    storage,
    new AtomicJsonFileService(storage, paths),
    manual,
  );
  return new CatalogService(manual, generated, paths);
}

function extraction(): IpdeMessageExtraction {
  return {
    schemaVersion: 1,
    primaryIntent: 'PROVIDE_SUBJECTS',
    secondaryIntents: [],
    requestPath: 'CATALOG_LIST',
    subjects: [
      {
        rawText: 'Andrología',
        displayNameCandidate: 'Andrología',
        normalizedNameCandidate: 'andrologia',
        categoryCandidate: 'SALUD',
        confidence: 0.95,
        isAcronym: false,
        needsClarification: false,
      },
    ],
    topicSelections: [],
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
    needsClarification: false,
    ambiguities: [],
    overallConfidence: 0.95,
  };
}

function generatedEntry(): SubjectCatalogEntry {
  const ids = new IpdeGeneratedEntryIdService();
  const id = ids.subjectId('andrologia');
  const now = '2026-06-19T00:00:00.000Z';
  return {
    schemaVersion: 1,
    id,
    tenantCode: 'IPDE',
    category: 'SALUD',
    displayName: 'Andrología',
    normalizedName: 'andrologia',
    aliases: [],
    allowedProductTypes: [...PRODUCT_TYPES],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: ids.topicId(id, index + 1),
      name: `Contenido persistente ${String(index + 1).padStart(2, '0')}`,
      aliases: [],
      active: true,
      priority: index + 1,
    })),
    source: 'OPENAI_GENERATED',
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    generationMetadata: {
      model: 'modelo-mock',
      generatedAt: now,
      promptVersion: 'v1-test',
    },
    usageMetadata: { useCount: 1, lastUsedAt: now },
  };
}

function createResolution(
  catalog: CatalogService,
  generate: jest.MockedFunction<IpdeSubjectListGenerationService['generate']>,
): IpdeCatalogResolutionService {
  const generator = { generate } as unknown as IpdeSubjectListGenerationService;
  return new IpdeCatalogResolutionService(
    catalog,
    new IpdeFuzzyCatalogMatchService(),
    generator,
    new IpdeGenerationLockService(),
    new IpdeTopicSelectionResolutionService(),
  );
}

describe('IPDE catalog resolution persistent reuse', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ipde-resolution-'));
    await writeFile(
      join(root, 'catalog.manual.json'),
      JSON.stringify({ schemaVersion: 1, tenantCode: 'IPDE', subjects: [] }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('saves a generated list and reuses it after recreating catalog services', async () => {
    const firstCatalog = createCatalog(root);
    await firstCatalog.initialize();
    const generate = jest.fn(() =>
      Promise.resolve({
        entry: generatedEntry(),
        diagnostics: {
          openAiCalls: 1,
          tokensInput: 100,
          tokensOutput: 200,
          latencyMs: 5,
        },
      }),
    );
    const first = createResolution(firstCatalog, generate);

    const created = await first.resolve({
      tenantCode: 'IPDE',
      extraction: extraction(),
    });
    expect(created.subjects[0].resolutionStatus).toBe('GENERATED_AND_SAVED');
    expect(generate).toHaveBeenCalledTimes(1);

    const recreatedCatalog = createCatalog(root);
    await recreatedCatalog.initialize();
    const shouldNotGenerate = jest.fn(() =>
      Promise.reject(new Error('OpenAI must not be called')),
    );
    const recreated = createResolution(recreatedCatalog, shouldNotGenerate);
    const reused = await recreated.resolve({
      tenantCode: 'IPDE',
      extraction: extraction(),
    });

    expect(reused.subjects[0]).toMatchObject({
      resolutionStatus: 'FOUND_GENERATED',
      catalogEntry: { usageMetadata: { useCount: 2 } },
    });
    expect(shouldNotGenerate).not.toHaveBeenCalled();
  });
});
