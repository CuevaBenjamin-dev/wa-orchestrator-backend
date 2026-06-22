import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
  CatalogEntryAlreadyExistsError,
  GeneratedCatalogEntryInvalidError,
} from '../domain/catalog.errors';
import {
  formatZodIssues,
  GeneratedSubjectCatalogEntrySchema,
} from '../domain/catalog.schemas';
import {
  CatalogMatch,
  IPDE_TENANT_CODE,
  SubjectCatalogEntry,
} from '../domain/catalog.types';
import { AtomicJsonFileService } from '../storage/atomic-json-file.service';
import { CatalogPathsService } from '../storage/catalog-paths.service';
import { PersistentStorageService } from '../storage/persistent-storage.service';
import { catalogFileName } from '../utils/catalog-file-name';
import { isFinalCatalogJsonFile } from '../utils/is-final-catalog-json-file';
import { normalizeCatalogText } from '../utils/normalize-catalog-text';
import { CatalogIndex } from './catalog-index';
import { ManualCatalogRepository } from './manual-catalog.repository';

type GeneratedInitializationResult = {
  generatedSubjects: number;
  quarantinedFiles: number;
};

@Injectable()
export class GeneratedCatalogRepository {
  private readonly logger = new Logger(GeneratedCatalogRepository.name);
  private readonly entriesByFile = new Map<string, SubjectCatalogEntry>();
  private readonly index = new CatalogIndex();
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly paths: CatalogPathsService,
    private readonly storage: PersistentStorageService,
    private readonly atomicJsonFile: AtomicJsonFileService,
    private readonly manualCatalog: ManualCatalogRepository,
  ) {}

  async initialize(): Promise<GeneratedInitializationResult> {
    const generatedDirectory = this.paths.getGeneratedCatalogDir();
    await this.storage.ensureDirectory(generatedDirectory);
    await this.storage.ensureDirectory(this.paths.getQuarantineDir());

    const fileNames = (await this.storage.listFileNames(generatedDirectory))
      .filter(isFinalCatalogJsonFile)
      .sort((left, right) => left.localeCompare(right));

    this.entriesByFile.clear();
    let quarantinedFiles = 0;
    const seenIds = new Set<string>();
    const seenSearchKeys = new Set<string>();

    for (const fileName of fileNames) {
      try {
        const entry = await this.loadFile(fileName);
        const conflict = this.manualCatalog.findConflict(entry);
        if (conflict) {
          throw new GeneratedCatalogEntryInvalidError(fileName, [
            {
              path: '<root>',
              message: `Generated entry conflicts with manual catalog key: ${conflict}`,
            },
          ]);
        }

        const searchKeys = this.getSearchKeys(entry);
        if (seenIds.has(entry.id)) {
          throw new GeneratedCatalogEntryInvalidError(fileName, [
            {
              path: 'id',
              message: `Duplicate generated subject id: ${entry.id}`,
            },
          ]);
        }

        const duplicateKey = searchKeys.find((key) => seenSearchKeys.has(key));
        if (duplicateKey) {
          throw new GeneratedCatalogEntryInvalidError(fileName, [
            {
              path: '<root>',
              message: `Duplicate generated subject name or alias: ${duplicateKey}`,
            },
          ]);
        }

        seenIds.add(entry.id);
        searchKeys.forEach((key) => seenSearchKeys.add(key));
        this.entriesByFile.set(fileName, entry);
      } catch (error) {
        const quarantined = await this.quarantineInvalidFile(fileName, error);
        if (quarantined) {
          quarantinedFiles += 1;
        }
      }
    }

    this.rebuildIndex();
    return { generatedSubjects: this.index.size, quarantinedFiles };
  }

  findExact(tenantCode: string, query: string): CatalogMatch | null {
    return tenantCode === IPDE_TENANT_CODE ? this.index.findExact(query) : null;
  }

  getById(tenantCode: string, id: string): SubjectCatalogEntry | null {
    return tenantCode === IPDE_TENANT_CODE ? this.index.getById(id) : null;
  }

  listAll(tenantCode: string, includeInactive = false): SubjectCatalogEntry[] {
    return tenantCode === IPDE_TENANT_CODE
      ? this.index.list(includeInactive)
      : [];
  }

  async saveGenerated(
    candidate: SubjectCatalogEntry,
  ): Promise<SubjectCatalogEntry> {
    const validation = GeneratedSubjectCatalogEntrySchema.safeParse(candidate);
    if (!validation.success) {
      throw new GeneratedCatalogEntryInvalidError(
        `<entry:${candidate.id || 'unknown'}>`,
        formatZodIssues(validation.error),
      );
    }

    const entry = validation.data;
    const manualConflict = this.manualCatalog.findConflict(entry);
    if (manualConflict) {
      throw new CatalogEntryAlreadyExistsError(manualConflict);
    }

    return this.withWriteLock(entry.normalizedName, async () => {
      const existingById = this.index.getById(entry.id);
      if (
        existingById &&
        existingById.normalizedName !== entry.normalizedName
      ) {
        throw new CatalogEntryAlreadyExistsError(entry.id);
      }

      for (const candidateKey of this.getSearchKeys(entry)) {
        const existingBySearchKey = this.index.findExact(candidateKey)?.entry;
        if (existingBySearchKey && existingBySearchKey.id !== entry.id) {
          throw new CatalogEntryAlreadyExistsError(candidateKey);
        }
      }

      return this.persistEntry(entry);
    });
  }

  async recordGeneratedUse(params: {
    tenantCode: string;
    id: string;
  }): Promise<SubjectCatalogEntry | null> {
    if (params.tenantCode !== IPDE_TENANT_CODE) {
      return null;
    }

    const current = this.index.getById(params.id);
    if (!current) {
      return null;
    }

    return this.withWriteLock(current.normalizedName, async () => {
      const latest = this.index.getById(params.id);
      if (!latest || latest.source !== 'OPENAI_GENERATED') {
        return null;
      }

      const now = new Date().toISOString();
      return this.persistEntry({
        ...latest,
        updatedAt: now,
        usageMetadata: {
          useCount: (latest.usageMetadata?.useCount ?? 0) + 1,
          lastUsedAt: now,
        },
      });
    });
  }

  private async loadFile(fileName: string): Promise<SubjectCatalogEntry> {
    const filePath = this.paths.resolveInside(
      this.paths.getGeneratedCatalogDir(),
      fileName,
    );
    const rawContent = await this.storage.readUtf8(filePath);

    let input: unknown;
    try {
      input = JSON.parse(rawContent) as unknown;
    } catch (error) {
      throw new GeneratedCatalogEntryInvalidError(
        fileName,
        [{ path: '<root>', message: 'Invalid JSON syntax' }],
        { cause: error },
      );
    }

    const validation = GeneratedSubjectCatalogEntrySchema.safeParse(input);
    if (!validation.success) {
      throw new GeneratedCatalogEntryInvalidError(
        fileName,
        formatZodIssues(validation.error),
      );
    }

    const expectedFileName = catalogFileName(validation.data.normalizedName);
    if (fileName !== expectedFileName) {
      throw new GeneratedCatalogEntryInvalidError(fileName, [
        {
          path: 'normalizedName',
          message: `Expected file name ${expectedFileName}`,
        },
      ]);
    }

    return validation.data;
  }

  private async quarantineInvalidFile(
    fileName: string,
    error: unknown,
  ): Promise<boolean> {
    const issues =
      error instanceof GeneratedCatalogEntryInvalidError
        ? error.issues
        : [
            {
              path: '<root>',
              message:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : 'Unknown generated catalog error',
            },
          ];

    this.logger.error(
      JSON.stringify({
        event: 'generated_catalog_file_invalid',
        file: basename(fileName),
        issues,
      }),
    );

    const sourcePath = this.paths.resolveInside(
      this.paths.getGeneratedCatalogDir(),
      fileName,
    );
    const quarantineName = `${fileName}.invalid-${Date.now()}-${randomUUID()}`;
    const quarantinePath = this.paths.resolveInside(
      this.paths.getQuarantineDir(),
      quarantineName,
    );

    try {
      await this.storage.moveFile(sourcePath, quarantinePath);
      return true;
    } catch (moveError) {
      this.logger.error(
        JSON.stringify({
          event: 'generated_catalog_quarantine_failed',
          file: basename(fileName),
          error:
            moveError instanceof Error ? moveError.name : 'UnknownStorageError',
        }),
      );
      return false;
    }
  }

  private getSearchKeys(entry: SubjectCatalogEntry): string[] {
    return [entry.normalizedName, ...entry.aliases.map(normalizeCatalogText)];
  }

  private rebuildIndex(): void {
    this.index.replace([...this.entriesByFile.values()]);
  }

  private async persistEntry(
    entry: SubjectCatalogEntry,
  ): Promise<SubjectCatalogEntry> {
    const fileName = catalogFileName(entry.normalizedName);
    const targetPath = this.paths.getGeneratedFilePath(entry.normalizedName);
    const saved = await this.atomicJsonFile.write({
      rootDirectory: this.paths.getGeneratedCatalogDir(),
      targetPath,
      value: entry,
      schema: GeneratedSubjectCatalogEntrySchema,
    });

    this.entriesByFile.set(fileName, saved);
    this.rebuildIndex();
    return saved;
  }

  private async withWriteLock<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    this.writeLocks.set(key, queued);

    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.writeLocks.get(key) === queued) {
        this.writeLocks.delete(key);
      }
    }
  }
}
