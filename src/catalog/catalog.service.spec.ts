import { ConfigService } from '@nestjs/config';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CatalogEntryAlreadyExistsError,
  ManualCatalogInvalidError,
  UnsafeCatalogPathError,
} from './domain/catalog.errors';
import { CatalogMatch, SubjectCatalogEntry } from './domain/catalog.types';
import { GeneratedCatalogRepository } from './repositories/generated-catalog.repository';
import { ManualCatalogRepository } from './repositories/manual-catalog.repository';
import { AtomicJsonFileService } from './storage/atomic-json-file.service';
import { CatalogPathsService } from './storage/catalog-paths.service';
import { PersistentStorageService } from './storage/persistent-storage.service';
import { normalizeCatalogText } from './utils/normalize-catalog-text';
import { CatalogService } from './catalog.service';

type Harness = {
  service: CatalogService;
  paths: CatalogPathsService;
  manual: ManualCatalogRepository;
  generated: GeneratedCatalogRepository;
};

const temporaryDirectories: string[] = [];

function createEntry(
  overrides: Partial<SubjectCatalogEntry> = {},
): SubjectCatalogEntry {
  const displayName = overrides.displayName ?? 'Materia Ficticia de Prueba';
  return {
    schemaVersion: 1,
    id: 'MATERIA_FICTICIA_DE_PRUEBA',
    tenantCode: 'IPDE',
    category: 'OTROS',
    displayName,
    normalizedName:
      overrides.normalizedName ?? normalizeCatalogText(displayName),
    aliases: ['Materia Demo'],
    allowedProductTypes: ['CURSO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `TEMA_FICTICIO_${String(index + 1).padStart(2, '0')}`,
      name: `Tema ficticio de prueba ${String(index + 1).padStart(2, '0')}`,
      aliases: [],
      active: true,
      priority: index + 1,
    })),
    source: 'OPENAI_GENERATED',
    active: true,
    version: 1,
    ...overrides,
  };
}

async function createTemporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ipde-catalog-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeManualCatalog(
  rootDirectory: string,
  subjects: SubjectCatalogEntry[],
): Promise<void> {
  await writeFile(
    join(rootDirectory, 'catalog.manual.json'),
    JSON.stringify({ schemaVersion: 1, tenantCode: 'IPDE', subjects }),
    'utf8',
  );
}

function createHarness(rootDirectory: string): Harness {
  const configService = new ConfigService({
    IPDE_TENANT_CODE: 'IPDE',
    IPDE_MANUAL_CATALOG_PATH: join(rootDirectory, 'catalog.manual.json'),
    PERSISTENT_DATA_DIR: join(rootDirectory, 'data'),
    IPDE_GENERATED_CATALOG_SUBDIR: 'generated-catalog',
  });
  const paths = new CatalogPathsService(configService);
  const storage = new PersistentStorageService();
  const atomicJson = new AtomicJsonFileService(storage, paths);
  const manual = new ManualCatalogRepository(paths, storage);
  const generated = new GeneratedCatalogRepository(
    paths,
    storage,
    atomicJson,
    manual,
  );
  const service = new CatalogService(manual, generated, paths);

  return { service, paths, manual, generated };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('CatalogService and repositories', () => {
  it('finds a manual subject by display name', async () => {
    const root = await createTemporaryRoot();
    const manualEntry = createEntry({ source: 'MANUAL' });
    await writeManualCatalog(root, [manualEntry]);
    const { service } = createHarness(root);
    await service.initialize();

    const match = await service.findExact({
      tenantCode: 'IPDE',
      query: manualEntry.displayName,
    });

    expect(match).toMatchObject({
      entry: { id: manualEntry.id },
      source: 'MANUAL',
      matchedBy: 'DISPLAY_NAME',
    });
  });

  it('finds a manual subject by normalized alias', async () => {
    const root = await createTemporaryRoot();
    const manualEntry = createEntry({
      source: 'MANUAL',
      aliases: ['Gestión Pública Demo'],
    });
    await writeManualCatalog(root, [manualEntry]);
    const { service } = createHarness(root);
    await service.initialize();

    const match = await service.findExact({
      tenantCode: 'IPDE',
      query: '  gestion   publica demo ',
    });

    expect(match).toMatchObject({
      entry: { id: manualEntry.id },
      source: 'MANUAL',
      matchedBy: 'ALIAS',
      matchedValue: 'Gestión Pública Demo',
    });
  });

  it('queries the manual repository before the generated repository', async () => {
    const entry = createEntry({ source: 'MANUAL' });
    const manualMatch: CatalogMatch = {
      entry,
      source: 'MANUAL',
      matchedBy: 'DISPLAY_NAME',
      matchedValue: entry.displayName,
    };
    const manual = {
      findExact: jest.fn().mockReturnValue(manualMatch),
    } as unknown as ManualCatalogRepository;
    const generatedFindExact = jest.fn();
    const generated = {
      findExact: generatedFindExact,
    } as unknown as GeneratedCatalogRepository;
    const service = new CatalogService(
      manual,
      generated,
      {} as CatalogPathsService,
    );

    await expect(
      service.findExact({ tenantCode: 'IPDE', query: entry.displayName }),
    ).resolves.toBe(manualMatch);
    expect(generatedFindExact).not.toHaveBeenCalled();
  });

  it('persists a generated subject after repositories are recreated', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const first = createHarness(root);
    await first.service.initialize();
    const entry = createEntry();
    await first.service.saveGenerated(entry);

    const recreated = createHarness(root);
    await recreated.service.initialize();

    await expect(
      recreated.service.getById({ tenantCode: 'IPDE', id: entry.id }),
    ).resolves.toMatchObject({ id: entry.id, version: 1 });
  });

  it('persists generated usage counters and recovers them after recreation', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const first = createHarness(root);
    await first.service.initialize();
    const entry = createEntry({
      usageMetadata: {
        useCount: 1,
        lastUsedAt: '2026-06-19T00:00:00.000Z',
      },
    });
    await first.service.saveGenerated(entry);

    const updated = await first.service.recordGeneratedUse({
      tenantCode: 'IPDE',
      id: entry.id,
    });

    expect(updated?.usageMetadata?.useCount).toBe(2);
    expect(updated?.usageMetadata?.lastUsedAt).toBeDefined();

    const recreated = createHarness(root);
    await recreated.service.initialize();
    await expect(
      recreated.service.getById({ tenantCode: 'IPDE', id: entry.id }),
    ).resolves.toMatchObject({ usageMetadata: { useCount: 2 } });
  });

  it('never updates usage metadata on a manual subject', async () => {
    const root = await createTemporaryRoot();
    const manualEntry = createEntry({
      source: 'MANUAL',
      usageMetadata: undefined,
    });
    await writeManualCatalog(root, [manualEntry]);
    const { service } = createHarness(root);
    await service.initialize();

    await expect(
      service.recordGeneratedUse({
        tenantCode: 'IPDE',
        id: manualEntry.id,
      }),
    ).resolves.toBeNull();
    await expect(
      service.getById({ tenantCode: 'IPDE', id: manualEntry.id }),
    ).resolves.not.toHaveProperty('usageMetadata');
  });

  it('serializes concurrent usage updates for a generated subject', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const { service } = createHarness(root);
    await service.initialize();
    const entry = createEntry({ usageMetadata: { useCount: 1 } });
    await service.saveGenerated(entry);

    await Promise.all([
      service.recordGeneratedUse({ tenantCode: 'IPDE', id: entry.id }),
      service.recordGeneratedUse({ tenantCode: 'IPDE', id: entry.id }),
    ]);

    await expect(
      service.getById({ tenantCode: 'IPDE', id: entry.id }),
    ).resolves.toMatchObject({ usageMetadata: { useCount: 3 } });
  });

  it('publishes complete JSON atomically without leftover temporary files', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const { service, paths } = createHarness(root);
    await service.initialize();
    const entry = createEntry();

    await service.saveGenerated(entry);

    const savedContent = await readFile(
      paths.getGeneratedFilePath(entry.normalizedName),
      'utf8',
    );
    expect(JSON.parse(savedContent)).toMatchObject({ id: entry.id });
    const fileNames = await readdir(paths.getGeneratedCatalogDir());
    expect(fileNames.some((fileName) => fileName.includes('.tmp-'))).toBe(
      false,
    );
  });

  it('quarantines corrupt generated JSON', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const { service, paths } = createHarness(root);
    await mkdir(paths.getGeneratedCatalogDir(), { recursive: true });
    await writeFile(
      join(paths.getGeneratedCatalogDir(), 'corrupto.json'),
      '{invalid-json',
      'utf8',
    );

    await expect(service.initialize()).resolves.toMatchObject({
      generatedSubjects: 0,
      quarantinedFiles: 1,
    });
    expect(await readdir(paths.getQuarantineDir())).toHaveLength(1);
  });

  it('rejects path traversal outside the generated directory', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const { paths } = createHarness(root);

    expect(() => paths.getGeneratedFilePath('../escape')).toThrow(
      UnsafeCatalogPathError,
    );
    expect(() =>
      paths.resolveInside(paths.getGeneratedCatalogDir(), '..', 'escape.json'),
    ).toThrow(UnsafeCatalogPathError);
  });

  it('serializes two concurrent writes for the same subject', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const { service, paths } = createHarness(root);
    await service.initialize();
    const firstVersion = createEntry({ version: 1 });
    const secondVersion = createEntry({ version: 2 });

    await Promise.all([
      service.saveGenerated(firstVersion),
      service.saveGenerated(secondVersion),
    ]);

    const saved = JSON.parse(
      await readFile(
        paths.getGeneratedFilePath(firstVersion.normalizedName),
        'utf8',
      ),
    ) as SubjectCatalogEntry;
    expect(saved.version).toBe(2);
    expect(
      (await readdir(paths.getGeneratedCatalogDir())).filter((fileName) =>
        fileName.includes('.tmp-'),
      ),
    ).toHaveLength(0);
  });

  it('fails initialization for an invalid manual catalog', async () => {
    const root = await createTemporaryRoot();
    await writeFile(
      join(root, 'catalog.manual.json'),
      JSON.stringify({
        schemaVersion: 1,
        tenantCode: 'IPDE',
        subjects: [{ schemaVersion: 1 }],
      }),
      'utf8',
    );
    const { service } = createHarness(root);

    await expect(service.initialize()).rejects.toBeInstanceOf(
      ManualCatalogInvalidError,
    );
  });

  it('quarantines an invalid generated entry without stopping initialization', async () => {
    const root = await createTemporaryRoot();
    await writeManualCatalog(root, []);
    const { service, paths } = createHarness(root);
    await mkdir(paths.getGeneratedCatalogDir(), { recursive: true });
    await writeFile(
      join(paths.getGeneratedCatalogDir(), 'entrada-invalida.json'),
      JSON.stringify({ schemaVersion: 1, tenantCode: 'IPDE' }),
      'utf8',
    );

    await expect(service.initialize()).resolves.toMatchObject({
      manualSubjects: 0,
      generatedSubjects: 0,
      quarantinedFiles: 1,
    });
  });

  it('does not allow generated content to overwrite a manual subject', async () => {
    const root = await createTemporaryRoot();
    const manualEntry = createEntry({ source: 'MANUAL' });
    await writeManualCatalog(root, [manualEntry]);
    const { service } = createHarness(root);
    await service.initialize();

    await expect(
      service.saveGenerated(createEntry({ source: 'OPENAI_GENERATED' })),
    ).rejects.toBeInstanceOf(CatalogEntryAlreadyExistsError);
  });
});
