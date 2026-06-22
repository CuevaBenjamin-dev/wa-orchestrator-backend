import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CatalogService } from '../../catalog/catalog.service';
import { CatalogEntryAlreadyExistsError } from '../../catalog/domain/catalog.errors';
import { SubjectCatalogEntrySchema } from '../../catalog/domain/catalog.schemas';
import {
  CatalogMatch,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import {
  IpdeGeneratedCatalogPersistenceError,
  IpdeSubjectGenerationAttemptsExhaustedError,
  IpdeSubjectGenerationUnavailableError,
  IpdeUnsafeSubjectInputError,
} from './ipde-catalog-resolution.errors';
import {
  IpdeCatalogResolutionInputSchema,
  IpdeCatalogResolutionResultSchema,
} from './ipde-catalog-resolution.schemas';
import {
  IpdeCatalogResolutionInput,
  IpdeCatalogResolutionResult,
  IpdeSubjectResolution,
  IpdeTopicGenerationDiagnostics,
} from './ipde-catalog-resolution.types';
import { IpdeFuzzyCatalogMatchService } from './ipde-fuzzy-catalog-match.service';
import { IpdeGenerationLockService } from './ipde-generation-lock.service';
import { IpdeSubjectListGenerationService } from './ipde-subject-list-generation.service';
import { IpdeTopicSelectionResolutionService } from './ipde-topic-selection-resolution.service';

const MAX_CONCURRENT_SUBJECTS = 3;

type SubjectCandidate = IpdeMessageExtraction['subjects'][number];
type SubjectWorkResult = {
  resolution: IpdeSubjectResolution;
  metadata: Omit<IpdeCatalogResolutionResult['metadata'], 'latencyMs'>;
};

function emptyMetadata(): SubjectWorkResult['metadata'] {
  return {
    manualMatches: 0,
    generatedMatches: 0,
    generatedNow: 0,
    openAiCalls: 0,
    tokensInput: 0,
    tokensOutput: 0,
  };
}

@Injectable()
export class IpdeCatalogResolutionService {
  private readonly logger = new Logger(IpdeCatalogResolutionService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly fuzzy: IpdeFuzzyCatalogMatchService,
    private readonly generator: IpdeSubjectListGenerationService,
    private readonly locks: IpdeGenerationLockService,
    private readonly numericSelections: IpdeTopicSelectionResolutionService,
  ) {}

  async resolve(
    candidate: IpdeCatalogResolutionInput,
  ): Promise<IpdeCatalogResolutionResult> {
    const input = IpdeCatalogResolutionInputSchema.parse(candidate);
    const startedAt = Date.now();
    const requestId = randomUUID();
    const numeric = this.numericSelections.resolve(
      input.extraction.topicSelections,
      input.presentedTopicLists ?? [],
    );

    if (input.extraction.requestPath === 'DIRECT_TOPICS') {
      const directTopics = this.resolveDirectTopics(input.extraction);
      const hasResolved =
        directTopics.length > 0 || numeric.resolved.length > 0;
      return this.validateResult({
        route:
          numeric.unresolved.length > 0
            ? 'NEEDS_CLARIFICATION'
            : hasResolved
              ? 'DIRECT_TOPICS'
              : 'NO_ACTION',
        subjects: [],
        directTopics,
        resolvedNumericSelections: numeric.resolved,
        unresolvedSelections: numeric.unresolved,
        metadata: { ...emptyMetadata(), latencyMs: Date.now() - startedAt },
      });
    }

    if (input.extraction.requestPath === 'UNDETERMINED') {
      return this.validateResult({
        route: 'NEEDS_CLARIFICATION',
        subjects: [],
        directTopics: [],
        resolvedNumericSelections: numeric.resolved,
        unresolvedSelections: numeric.unresolved,
        metadata: { ...emptyMetadata(), latencyMs: Date.now() - startedAt },
      });
    }

    const catalogEntries = await this.catalog.listAll({
      tenantCode: input.tenantCode,
    });
    const work = await this.mapWithConcurrency(
      input.extraction.subjects,
      MAX_CONCURRENT_SUBJECTS,
      (subject) =>
        this.resolveSubject(
          input.tenantCode,
          subject,
          catalogEntries,
          requestId,
        ),
    );
    const metadata = work.reduce(
      (total, item) => ({
        manualMatches: total.manualMatches + item.metadata.manualMatches,
        generatedMatches:
          total.generatedMatches + item.metadata.generatedMatches,
        generatedNow: total.generatedNow + item.metadata.generatedNow,
        openAiCalls: total.openAiCalls + item.metadata.openAiCalls,
        tokensInput: total.tokensInput + item.metadata.tokensInput,
        tokensOutput: total.tokensOutput + item.metadata.tokensOutput,
      }),
      emptyMetadata(),
    );
    const subjects = work.map((item) => item.resolution);
    const hasProblem =
      subjects.length === 0 ||
      subjects.some((subject) =>
        ['AMBIGUOUS', 'FAILED'].includes(subject.resolutionStatus),
      ) ||
      numeric.unresolved.length > 0;

    return this.validateResult({
      route: hasProblem ? 'NEEDS_CLARIFICATION' : 'CATALOG_LISTS_READY',
      subjects,
      directTopics: [],
      resolvedNumericSelections: numeric.resolved,
      unresolvedSelections: numeric.unresolved,
      metadata: { ...metadata, latencyMs: Date.now() - startedAt },
    });
  }

  private async resolveSubject(
    tenantCode: 'IPDE',
    subject: SubjectCandidate,
    catalogEntries: SubjectCatalogEntry[],
    requestId: string,
  ): Promise<SubjectWorkResult> {
    const base = this.subjectBase(subject);
    if (subject.isAcronym || subject.needsClarification) {
      return {
        resolution: {
          ...base,
          resolutionStatus: 'AMBIGUOUS',
          catalogEntry: null,
          matchedBy: null,
          clarificationCandidates: [],
          errorCode: subject.isAcronym
            ? 'AMBIGUOUS_ACRONYM'
            : 'AMBIGUOUS_SUBJECT',
        },
        metadata: emptyMetadata(),
      };
    }

    try {
      const exact = await this.catalog.findExact({
        tenantCode,
        query: subject.displayNameCandidate,
      });
      if (exact) return this.found(subject, exact, exact.matchedBy);

      const fuzzyResult = this.fuzzy.find(
        subject.displayNameCandidate,
        catalogEntries,
      );
      if (fuzzyResult.kind === 'MATCH') {
        return this.found(
          subject,
          {
            entry: fuzzyResult.entry,
            source: fuzzyResult.entry.source,
            matchedBy: 'NORMALIZED_NAME',
            matchedValue: fuzzyResult.entry.normalizedName,
          },
          'FUZZY',
        );
      }
      if (fuzzyResult.kind === 'AMBIGUOUS') {
        return {
          resolution: {
            ...base,
            resolutionStatus: 'AMBIGUOUS',
            catalogEntry: null,
            matchedBy: null,
            clarificationCandidates: fuzzyResult.candidates.map(
              (candidate) => candidate.entry.displayName,
            ),
            errorCode: 'AMBIGUOUS_FUZZY_MATCH',
          },
          metadata: emptyMetadata(),
        };
      }

      return await this.locks.withLock(
        `${tenantCode}:${subject.normalizedNameCandidate}`,
        () => this.generateInsideLock(tenantCode, subject),
      );
    } catch (error) {
      const diagnostics = this.diagnosticsFrom(error);
      const errorCode = this.errorCode(error);
      this.logger.warn(
        JSON.stringify({
          event: 'ipde_catalog_subject_resolution_failed',
          requestId,
          subjectKey: this.safeSubjectKey(subject.normalizedNameCandidate),
          code: errorCode,
        }),
      );
      return {
        resolution: {
          ...base,
          resolutionStatus: 'FAILED',
          catalogEntry: null,
          matchedBy: null,
          clarificationCandidates: [],
          errorCode,
        },
        metadata: {
          ...emptyMetadata(),
          openAiCalls: diagnostics.openAiCalls,
          tokensInput: diagnostics.tokensInput,
          tokensOutput: diagnostics.tokensOutput,
        },
      };
    }
  }

  private async generateInsideLock(
    tenantCode: 'IPDE',
    subject: SubjectCandidate,
  ): Promise<SubjectWorkResult> {
    const existing = await this.catalog.findExact({
      tenantCode,
      query: subject.displayNameCandidate,
    });
    if (existing) return this.found(subject, existing, existing.matchedBy);

    const generated = await this.generator.generate({
      tenantCode,
      requestedDisplayName: subject.displayNameCandidate,
      normalizedName: subject.normalizedNameCandidate,
      categoryCandidate: subject.categoryCandidate,
    });

    try {
      const saved = await this.catalog.saveGenerated(generated.entry);
      return {
        resolution: {
          ...this.subjectBase(subject),
          category: saved.category,
          resolutionStatus: 'GENERATED_AND_SAVED',
          catalogEntry: SubjectCatalogEntrySchema.parse(saved),
          matchedBy: 'GENERATED',
          clarificationCandidates: [],
          errorCode: null,
        },
        metadata: {
          ...emptyMetadata(),
          generatedNow: 1,
          openAiCalls: generated.diagnostics.openAiCalls,
          tokensInput: generated.diagnostics.tokensInput,
          tokensOutput: generated.diagnostics.tokensOutput,
        },
      };
    } catch (error) {
      if (error instanceof CatalogEntryAlreadyExistsError) {
        const raced = await this.catalog.findExact({
          tenantCode,
          query: subject.displayNameCandidate,
        });
        if (raced) {
          const result = await this.found(subject, raced, raced.matchedBy);
          result.metadata.openAiCalls += generated.diagnostics.openAiCalls;
          result.metadata.tokensInput += generated.diagnostics.tokensInput;
          result.metadata.tokensOutput += generated.diagnostics.tokensOutput;
          return result;
        }
      }
      throw new IpdeGeneratedCatalogPersistenceError(generated.diagnostics);
    }
  }

  private async found(
    subject: SubjectCandidate,
    match: CatalogMatch,
    matchedBy: IpdeSubjectResolution['matchedBy'],
  ): Promise<SubjectWorkResult> {
    let entry = match.entry;
    const metadata = emptyMetadata();
    if (entry.source === 'MANUAL') {
      metadata.manualMatches = 1;
    } else {
      metadata.generatedMatches = 1;
      try {
        entry =
          (await this.catalog.recordGeneratedUse({
            tenantCode: 'IPDE',
            id: entry.id,
          })) ?? entry;
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'ipde_generated_catalog_usage_update_failed',
            subjectKey: this.safeSubjectKey(entry.normalizedName),
            code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          }),
        );
      }
    }

    return {
      resolution: {
        ...this.subjectBase(subject),
        category: entry.category,
        resolutionStatus:
          entry.source === 'MANUAL' ? 'FOUND_MANUAL' : 'FOUND_GENERATED',
        catalogEntry: SubjectCatalogEntrySchema.parse(entry),
        matchedBy,
        clarificationCandidates: [],
        errorCode: null,
      },
      metadata,
    };
  }

  private resolveDirectTopics(
    extraction: IpdeMessageExtraction,
  ): IpdeCatalogResolutionResult['directTopics'] {
    const seen = new Set<string>();
    return extraction.topicSelections.flatMap((selection) =>
      selection.selectedNames.flatMap((topicName) => {
        const normalizedTopicName = normalizeCatalogText(topicName);
        if (!normalizedTopicName || seen.has(normalizedTopicName)) return [];
        seen.add(normalizedTopicName);
        return [
          {
            rawText: selection.rawText,
            topicName,
            normalizedTopicName,
            subjectReference: selection.subjectReference,
            confidence: selection.confidence,
          },
        ];
      }),
    );
  }

  private subjectBase(subject: SubjectCandidate) {
    return {
      rawText: subject.rawText,
      requestedDisplayName: subject.displayNameCandidate,
      normalizedQuery: subject.normalizedNameCandidate,
      category: subject.categoryCandidate,
    };
  }

  private diagnosticsFrom(error: unknown): IpdeTopicGenerationDiagnostics {
    if (
      error instanceof IpdeSubjectGenerationUnavailableError ||
      error instanceof IpdeSubjectGenerationAttemptsExhaustedError ||
      error instanceof IpdeGeneratedCatalogPersistenceError
    ) {
      return error.diagnostics;
    }
    return { openAiCalls: 0, tokensInput: 0, tokensOutput: 0, latencyMs: 0 };
  }

  private errorCode(error: unknown): string {
    if (error instanceof IpdeSubjectGenerationUnavailableError) {
      return error.code;
    }
    if (error instanceof IpdeSubjectGenerationAttemptsExhaustedError) {
      return 'GENERATION_ATTEMPTS_EXHAUSTED';
    }
    if (error instanceof IpdeUnsafeSubjectInputError) {
      return error.code;
    }
    if (error instanceof IpdeGeneratedCatalogPersistenceError) {
      return 'GENERATED_CATALOG_PERSISTENCE_FAILED';
    }
    return 'CATALOG_RESOLUTION_FAILED';
  }

  private safeSubjectKey(normalizedName: string): string {
    return normalizedName.slice(0, 40);
  }

  private validateResult(
    result: IpdeCatalogResolutionResult,
  ): IpdeCatalogResolutionResult {
    return IpdeCatalogResolutionResultSchema.parse(result);
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    action: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await action(items[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, () =>
        worker(),
      ),
    );
    return results;
  }
}
