import { Injectable } from '@nestjs/common';
import { ManualCatalogInvalidError } from '../domain/catalog.errors';
import {
  formatZodIssues,
  ManualCatalogFileSchema,
} from '../domain/catalog.schemas';
import {
  CatalogMatch,
  IPDE_TENANT_CODE,
  SubjectCatalogEntry,
} from '../domain/catalog.types';
import { CatalogPathsService } from '../storage/catalog-paths.service';
import { PersistentStorageService } from '../storage/persistent-storage.service';
import { CatalogIndex } from './catalog-index';

@Injectable()
export class ManualCatalogRepository {
  private readonly index = new CatalogIndex();

  constructor(
    private readonly paths: CatalogPathsService,
    private readonly storage: PersistentStorageService,
  ) {}

  async initialize(): Promise<number> {
    const filePath = this.paths.getManualCatalogPath();
    let rawContent: string;

    try {
      rawContent = await this.storage.readUtf8(filePath);
    } catch (error) {
      throw new ManualCatalogInvalidError(
        filePath,
        [{ path: '<root>', message: 'Unable to read manual catalog file' }],
        { cause: error },
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(rawContent) as unknown;
    } catch (error) {
      throw new ManualCatalogInvalidError(
        filePath,
        [{ path: '<root>', message: 'Invalid JSON syntax' }],
        { cause: error },
      );
    }

    const validation = ManualCatalogFileSchema.safeParse(input);
    if (!validation.success) {
      throw new ManualCatalogInvalidError(
        filePath,
        formatZodIssues(validation.error),
      );
    }

    this.index.replace(validation.data.subjects);
    return this.index.size;
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

  findConflict(entry: SubjectCatalogEntry): string | null {
    if (this.index.getById(entry.id)) {
      return entry.id;
    }

    for (const candidate of [
      entry.displayName,
      entry.normalizedName,
      ...entry.aliases,
    ]) {
      if (this.index.findExact(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
