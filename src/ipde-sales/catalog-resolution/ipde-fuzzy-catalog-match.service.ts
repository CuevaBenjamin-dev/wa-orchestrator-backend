import { Injectable } from '@nestjs/common';
import { SubjectCatalogEntry } from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeFuzzyCatalogResult } from './ipde-catalog-resolution.types';

export const IPDE_FUZZY_AUTO_MATCH_THRESHOLD = 0.92;
export const IPDE_FUZZY_CANDIDATE_THRESHOLD = 0.82;
export const IPDE_FUZZY_UNIQUE_MARGIN = 0.08;

@Injectable()
export class IpdeFuzzyCatalogMatchService {
  find(query: string, entries: SubjectCatalogEntry[]): IpdeFuzzyCatalogResult {
    const normalizedQuery = normalizeCatalogText(query);
    if (!normalizedQuery) return { kind: 'NONE' };

    const candidates = entries
      .filter((entry) => entry.active)
      .map((entry) => ({
        entry,
        score: Math.max(
          ...[entry.normalizedName, ...entry.aliases].map((value) =>
            this.similarity(normalizedQuery, normalizeCatalogText(value)),
          ),
        ),
      }))
      .filter(
        ({ entry, score }) =>
          score >= IPDE_FUZZY_CANDIDATE_THRESHOLD &&
          this.hasSafeTokenShape(normalizedQuery, entry.normalizedName),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          Number(right.entry.source === 'MANUAL') -
            Number(left.entry.source === 'MANUAL') ||
          left.entry.id.localeCompare(right.entry.id),
      );

    if (candidates.length === 0) return { kind: 'NONE' };

    const top = candidates[0];
    const runnerUp = candidates[1];
    if (
      top.score >= IPDE_FUZZY_AUTO_MATCH_THRESHOLD &&
      (!runnerUp || top.score - runnerUp.score >= IPDE_FUZZY_UNIQUE_MARGIN)
    ) {
      return { kind: 'MATCH', entry: top.entry, score: top.score };
    }

    return { kind: 'AMBIGUOUS', candidates: candidates.slice(0, 5) };
  }

  private similarity(left: string, right: string): number {
    const maximumLength = Math.max(left.length, right.length);
    if (maximumLength === 0) return 1;
    return 1 - this.levenshtein(left, right) / maximumLength;
  }

  private levenshtein(left: string, right: string): number {
    let previous = Array.from(
      { length: right.length + 1 },
      (_, index) => index,
    );
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const substitutionCost =
          left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + substitutionCost,
        );
      }
      previous = current;
    }
    return previous[right.length];
  }

  private hasSafeTokenShape(query: string, candidate: string): boolean {
    const stopWords = new Set(['de', 'del', 'la', 'el', 'y', 'en']);
    const queryTokens = query
      .split(' ')
      .filter((token) => !stopWords.has(token));
    const candidateTokens = candidate
      .split(' ')
      .filter((token) => !stopWords.has(token));

    return (
      queryTokens.every((token) =>
        candidateTokens.some(
          (candidateToken) => this.similarity(token, candidateToken) >= 0.8,
        ),
      ) &&
      candidateTokens.every((token) =>
        queryTokens.some(
          (queryToken) => this.similarity(token, queryToken) >= 0.8,
        ),
      )
    );
  }
}
