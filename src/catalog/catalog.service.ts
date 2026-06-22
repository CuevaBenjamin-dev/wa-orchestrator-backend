import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CatalogInitializationSummary,
  CatalogMatch,
  SubjectCatalogEntry,
} from './domain/catalog.types';
import { CatalogRepository } from './repositories/catalog.repository';
import { GeneratedCatalogRepository } from './repositories/generated-catalog.repository';
import { ManualCatalogRepository } from './repositories/manual-catalog.repository';
import { CatalogPathsService } from './storage/catalog-paths.service';

@Injectable()
export class CatalogService implements CatalogRepository, OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly manualCatalog: ManualCatalogRepository,
    private readonly generatedCatalog: GeneratedCatalogRepository,
    private readonly paths: CatalogPathsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async initialize(): Promise<CatalogInitializationSummary> {
    this.paths.getTenantCode();
    const manualSubjects = await this.manualCatalog.initialize();
    const generated = await this.generatedCatalog.initialize();
    const summary: CatalogInitializationSummary = {
      manualSubjects,
      generatedSubjects: generated.generatedSubjects,
      quarantinedFiles: generated.quarantinedFiles,
      persistentPath: this.paths.getPersistentDataDir(),
    };

    this.logger.log(`Manual catalog subjects: ${summary.manualSubjects}`);
    this.logger.log(`Generated catalog subjects: ${summary.generatedSubjects}`);
    this.logger.log(`Quarantined files: ${summary.quarantinedFiles}`);
    this.logger.log(`Persistent path: ${summary.persistentPath}`);

    return summary;
  }

  findExact(params: {
    tenantCode: string;
    query: string;
  }): Promise<CatalogMatch | null> {
    return Promise.resolve(
      this.manualCatalog.findExact(params.tenantCode, params.query) ??
        this.generatedCatalog.findExact(params.tenantCode, params.query),
    );
  }

  listAll(params: {
    tenantCode: string;
    includeInactive?: boolean;
  }): Promise<SubjectCatalogEntry[]> {
    const manual = this.manualCatalog.listAll(
      params.tenantCode,
      params.includeInactive,
    );
    const manualIds = new Set(manual.map((entry) => entry.id));
    const generated = this.generatedCatalog
      .listAll(params.tenantCode, params.includeInactive)
      .filter((entry) => !manualIds.has(entry.id));

    return Promise.resolve([...manual, ...generated]);
  }

  getById(params: {
    tenantCode: string;
    id: string;
  }): Promise<SubjectCatalogEntry | null> {
    return Promise.resolve(
      this.manualCatalog.getById(params.tenantCode, params.id) ??
        this.generatedCatalog.getById(params.tenantCode, params.id),
    );
  }

  saveGenerated(entry: SubjectCatalogEntry): Promise<SubjectCatalogEntry> {
    return this.generatedCatalog.saveGenerated(entry);
  }

  recordGeneratedUse(params: {
    tenantCode: string;
    id: string;
  }): Promise<SubjectCatalogEntry | null> {
    return this.generatedCatalog.recordGeneratedUse(params);
  }
}
