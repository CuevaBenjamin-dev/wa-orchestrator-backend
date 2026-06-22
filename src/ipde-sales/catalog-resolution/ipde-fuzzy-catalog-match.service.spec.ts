import { SubjectCatalogEntry } from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeFuzzyCatalogMatchService } from './ipde-fuzzy-catalog-match.service';

function entry(
  displayName: string,
  source: 'MANUAL' | 'OPENAI_GENERATED' = 'MANUAL',
): SubjectCatalogEntry {
  const id = normalizeCatalogText(displayName).replace(/ /g, '_').toUpperCase();
  return {
    schemaVersion: 1,
    id,
    tenantCode: 'IPDE',
    category: 'OTROS',
    displayName,
    normalizedName: normalizeCatalogText(displayName),
    aliases: [],
    allowedProductTypes: ['CURSO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `${id}_TOPIC_${String(index + 1).padStart(2, '0')}`,
      name: `Contenido ${String(index + 1).padStart(2, '0')}`,
      active: true,
      priority: index + 1,
    })),
    source,
    active: true,
    version: 1,
  };
}

describe('IpdeFuzzyCatalogMatchService', () => {
  const service = new IpdeFuzzyCatalogMatchService();

  it('accepts a unique high-confidence typo', () => {
    const result = service.find('Derecho Civl', [entry('Derecho Civil')]);
    expect(result).toMatchObject({ kind: 'MATCH' });
  });

  it('returns close candidates instead of choosing an ambiguous match', () => {
    const result = service.find('Gestión Pública Regional', [
      entry('Gestión Pública Regional'),
      entry('Gestión Pública Regonal'),
    ]);
    expect(result).toMatchObject({ kind: 'AMBIGUOUS' });
  });

  it('does not drop the semantically important word procesal', () => {
    const result = service.find('Derecho Civil', [
      entry('Derecho Procesal Civil'),
    ]);
    expect(result).toEqual({ kind: 'NONE' });
  });

  it('returns no match for a low score', () => {
    expect(service.find('Andrología', [entry('Derecho Penal')])).toEqual({
      kind: 'NONE',
    });
  });
});
