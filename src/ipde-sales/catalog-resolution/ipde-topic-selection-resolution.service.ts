import { Injectable } from '@nestjs/common';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import {
  IpdePresentedTopicList,
  IpdeResolvedNumericSelection,
  IpdeUnresolvedSelection,
} from './ipde-catalog-resolution.types';

export interface IpdeNumericSelectionResolution {
  resolved: IpdeResolvedNumericSelection[];
  unresolved: IpdeUnresolvedSelection[];
}

@Injectable()
export class IpdeTopicSelectionResolutionService {
  resolve(
    selections: IpdeMessageExtraction['topicSelections'],
    lists: IpdePresentedTopicList[],
  ): IpdeNumericSelectionResolution {
    const unresolved: IpdeUnresolvedSelection[] = [];
    const resolvedBySubject = new Map<string, IpdeResolvedNumericSelection>();

    for (const selection of selections) {
      if (selection.selectedNumbers.length === 0) continue;
      if (lists.length === 0) {
        unresolved.push({
          rawText: selection.rawText,
          reason: 'NO_PRESENTED_LIST',
        });
        continue;
      }

      if (!selection.subjectReference && lists.length > 1) {
        unresolved.push({
          rawText: selection.rawText,
          reason: 'AMBIGUOUS_SELECTION',
        });
        continue;
      }

      const matches = this.findLists(selection.subjectReference, lists);
      if (matches.length === 0) {
        unresolved.push({
          rawText: selection.rawText,
          reason: 'UNKNOWN_SUBJECT_REFERENCE',
        });
        continue;
      }
      if (matches.length > 1) {
        unresolved.push({
          rawText: selection.rawText,
          reason: 'AMBIGUOUS_SELECTION',
        });
        continue;
      }

      const list = matches[0];
      const selectedNumbers = [...new Set(selection.selectedNumbers)];
      const missingPosition = selectedNumbers.some(
        (position) => !list.topics.some((topic) => topic.position === position),
      );
      if (missingPosition) {
        unresolved.push({
          rawText: selection.rawText,
          reason: 'POSITION_NOT_AVAILABLE',
        });
      }

      const current = resolvedBySubject.get(list.subjectDisplayName) ?? {
        subjectDisplayName: list.subjectDisplayName,
        selectedTopics: [],
      };
      const existingPositions = new Set(
        current.selectedTopics.map((topic) => topic.position),
      );
      for (const position of selectedNumbers) {
        const topic = list.topics.find(
          (candidate) => candidate.position === position,
        );
        if (!topic || existingPositions.has(position)) continue;
        current.selectedTopics.push({
          position,
          topicId: topic.topicId ?? null,
          topicName: topic.topicName,
        });
        existingPositions.add(position);
      }
      if (current.selectedTopics.length > 0) {
        resolvedBySubject.set(list.subjectDisplayName, current);
      }
    }

    return { resolved: [...resolvedBySubject.values()], unresolved };
  }

  private findLists(
    subjectReference: string | null,
    lists: IpdePresentedTopicList[],
  ): IpdePresentedTopicList[] {
    if (!subjectReference) return lists.length === 1 ? lists : [];

    const reference = normalizeCatalogText(subjectReference);
    const exact = lists.filter(
      (list) => normalizeCatalogText(list.subjectDisplayName) === reference,
    );
    if (exact.length > 0) return exact;

    return lists.filter((list) => {
      const normalized = normalizeCatalogText(list.subjectDisplayName);
      return normalized.split(' ').at(-1) === reference;
    });
  }
}
