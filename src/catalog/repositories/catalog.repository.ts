import { CatalogMatch, SubjectCatalogEntry } from '../domain/catalog.types';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface CatalogRepository {
  findExact(params: {
    tenantCode: string;
    query: string;
  }): Promise<CatalogMatch | null>;

  listAll(params: {
    tenantCode: string;
    includeInactive?: boolean;
  }): Promise<SubjectCatalogEntry[]>;

  getById(params: {
    tenantCode: string;
    id: string;
  }): Promise<SubjectCatalogEntry | null>;

  saveGenerated(entry: SubjectCatalogEntry): Promise<SubjectCatalogEntry>;

  recordGeneratedUse(params: {
    tenantCode: string;
    id: string;
  }): Promise<SubjectCatalogEntry | null>;
}
