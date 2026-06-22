import { z } from 'zod';
import {
  CommercialCategory,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import {
  IpdeCatalogResolutionInputSchema,
  IpdeCatalogResolutionResultSchema,
  IpdePresentedTopicListSchema,
} from './ipde-catalog-resolution.schemas';

export type IpdeCatalogResolutionInput = z.infer<
  typeof IpdeCatalogResolutionInputSchema
>;
export type IpdeCatalogResolutionResult = z.infer<
  typeof IpdeCatalogResolutionResultSchema
>;
export type IpdePresentedTopicList = z.infer<
  typeof IpdePresentedTopicListSchema
>;

export type IpdeSubjectResolution =
  IpdeCatalogResolutionResult['subjects'][number];
export type IpdeResolvedNumericSelection =
  IpdeCatalogResolutionResult['resolvedNumericSelections'][number];
export type IpdeUnresolvedSelection =
  IpdeCatalogResolutionResult['unresolvedSelections'][number];

export interface IpdeTopicGenerationDiagnostics {
  openAiCalls: number;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
}

export interface GenerateIpdeSubjectEntryInput {
  tenantCode: 'IPDE';
  requestedDisplayName: string;
  normalizedName: string;
  categoryCandidate: CommercialCategory | null;
}

export interface GeneratedIpdeSubjectEntryResult {
  entry: SubjectCatalogEntry;
  diagnostics: IpdeTopicGenerationDiagnostics;
}

export type IpdeFuzzyCatalogResult =
  | {
      kind: 'MATCH';
      entry: SubjectCatalogEntry;
      score: number;
    }
  | {
      kind: 'AMBIGUOUS';
      candidates: Array<{ entry: SubjectCatalogEntry; score: number }>;
    }
  | { kind: 'NONE' };
