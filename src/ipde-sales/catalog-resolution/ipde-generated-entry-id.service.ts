import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeUnsafeSubjectInputError } from './ipde-catalog-resolution.errors';

@Injectable()
export class IpdeGeneratedEntryIdService {
  subjectId(normalizedName: string): string {
    const normalized = normalizeCatalogText(normalizedName);
    if (!normalized || normalized !== normalizedName) {
      throw new IpdeUnsafeSubjectInputError('INVALID_NORMALIZED_NAME');
    }

    const slug = normalized
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    if (!slug) {
      throw new IpdeUnsafeSubjectInputError('SUBJECT_ID_SLUG_EMPTY');
    }

    const hash = createHash('sha256')
      .update(`IPDE:${normalized}`, 'utf8')
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();
    return `GEN_${slug}_${hash}`;
  }

  topicId(subjectId: string, position: number): string {
    if (!Number.isInteger(position) || position < 1 || position > 25) {
      throw new RangeError('Generated topic position must be between 1 and 25');
    }
    return `${subjectId}_TOPIC_${String(position).padStart(2, '0')}`;
  }
}
