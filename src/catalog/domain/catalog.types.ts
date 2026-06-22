export const IPDE_TENANT_CODE = 'IPDE' as const;

export const COMMERCIAL_CATEGORIES = [
  'DERECHO',
  'EDUCACION',
  'GESTION_PUBLICA',
  'SALUD',
  'INGENIERIA',
  'ADMINISTRACION',
  'CONTABILIDAD',
  'PSICOLOGIA',
  'TECNOLOGIA',
  'OTROS',
] as const;

export const PRODUCT_TYPES = [
  'DIPLOMADO',
  'ESPECIALIZACION',
  'CURSO',
  'CURSO_CAPACITACION',
  'CURSO_ACTUALIZACION',
  'CURSO_ESPECIALIZACION',
] as const;

export const CATALOG_SOURCES = ['MANUAL', 'OPENAI_GENERATED'] as const;

export type CommercialCategory = (typeof COMMERCIAL_CATEGORIES)[number];
export type ProductType = (typeof PRODUCT_TYPES)[number];
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

export interface Topic {
  id: string;
  name: string;
  aliases?: string[];
  active: boolean;
  priority: number;
}

export interface GenerationMetadata {
  model?: string;
  generatedAt?: string;
  promptVersion?: string;
}

export interface UsageMetadata {
  useCount: number;
  lastUsedAt?: string;
}

export interface SubjectCatalogEntry {
  schemaVersion: 1;
  id: string;
  tenantCode: typeof IPDE_TENANT_CODE;
  category: CommercialCategory;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  allowedProductTypes: ProductType[];
  topics: Topic[];
  source: CatalogSource;
  active: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  generationMetadata?: GenerationMetadata;
  usageMetadata?: UsageMetadata;
}

export interface ManualCatalogFile {
  schemaVersion: 1;
  tenantCode: typeof IPDE_TENANT_CODE;
  subjects: SubjectCatalogEntry[];
}

export type CatalogMatchedBy = 'DISPLAY_NAME' | 'NORMALIZED_NAME' | 'ALIAS';

export interface CatalogMatch {
  entry: SubjectCatalogEntry;
  source: CatalogSource;
  matchedBy: CatalogMatchedBy;
  matchedValue: string;
}

export interface CatalogInitializationSummary {
  manualSubjects: number;
  generatedSubjects: number;
  quarantinedFiles: number;
  persistentPath: string;
}
