import { SubjectCatalogEntrySchema } from './catalog.schemas';
import { SubjectCatalogEntry } from './catalog.types';
import { normalizeCatalogText } from '../utils/normalize-catalog-text';

function createEntry(): SubjectCatalogEntry {
  const displayName = 'Materia Ficticia de Prueba';
  return {
    schemaVersion: 1,
    id: 'MATERIA_FICTICIA_DE_PRUEBA',
    tenantCode: 'IPDE',
    category: 'OTROS',
    displayName,
    normalizedName: normalizeCatalogText(displayName),
    aliases: ['Materia Demo'],
    allowedProductTypes: ['CURSO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `TEMA_FICTICIO_${String(index + 1).padStart(2, '0')}`,
      name: `Tema ficticio de prueba ${String(index + 1).padStart(2, '0')}`,
      active: true,
      priority: index + 1,
    })),
    source: 'OPENAI_GENERATED',
    active: true,
    version: 1,
  };
}

describe('SubjectCatalogEntrySchema', () => {
  it('accepts exactly 25 active topics', () => {
    expect(SubjectCatalogEntrySchema.safeParse(createEntry()).success).toBe(
      true,
    );
  });

  it('rejects entries without exactly 25 topics', () => {
    const entry = createEntry();
    entry.topics.pop();

    const result = SubjectCatalogEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === 'topics'),
      ).toBe(true);
    }
  });

  it('rejects duplicate topic names after normalization', () => {
    const entry = createEntry();
    entry.topics[24].name = '  Téma   Fictício de Prueba 01 ';

    const result = SubjectCatalogEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes('Duplicate normalized topic name'),
        ),
      ).toBe(true);
    }
  });
});
