import { CatalogMatch, SubjectCatalogEntry } from '../domain/catalog.types';
import { normalizeCatalogText } from '../utils/normalize-catalog-text';

export class CatalogIndex {
  private readonly entriesById = new Map<string, SubjectCatalogEntry>();
  private readonly displayNames = new Map<string, SubjectCatalogEntry>();
  private readonly normalizedNames = new Map<string, SubjectCatalogEntry>();
  private readonly aliases = new Map<
    string,
    { entry: SubjectCatalogEntry; original: string }
  >();

  replace(entries: SubjectCatalogEntry[]): void {
    this.entriesById.clear();
    this.displayNames.clear();
    this.normalizedNames.clear();
    this.aliases.clear();

    for (const entry of entries) {
      this.entriesById.set(entry.id, entry);
      this.displayNames.set(entry.displayName.trim(), entry);
      this.normalizedNames.set(entry.normalizedName, entry);
      for (const alias of entry.aliases) {
        this.aliases.set(normalizeCatalogText(alias), {
          entry,
          original: alias,
        });
      }
    }
  }

  findExact(query: string): CatalogMatch | null {
    const trimmed = query.trim();
    const displayNameMatch = this.displayNames.get(trimmed);
    if (displayNameMatch) {
      return {
        entry: displayNameMatch,
        source: displayNameMatch.source,
        matchedBy: 'DISPLAY_NAME',
        matchedValue: displayNameMatch.displayName,
      };
    }

    const normalizedQuery = normalizeCatalogText(query);
    if (!normalizedQuery) {
      return null;
    }

    const normalizedNameMatch = this.normalizedNames.get(normalizedQuery);
    if (normalizedNameMatch) {
      return {
        entry: normalizedNameMatch,
        source: normalizedNameMatch.source,
        matchedBy: 'NORMALIZED_NAME',
        matchedValue: normalizedNameMatch.normalizedName,
      };
    }

    const aliasMatch = this.aliases.get(normalizedQuery);
    if (aliasMatch) {
      return {
        entry: aliasMatch.entry,
        source: aliasMatch.entry.source,
        matchedBy: 'ALIAS',
        matchedValue: aliasMatch.original,
      };
    }

    return null;
  }

  getById(id: string): SubjectCatalogEntry | null {
    return this.entriesById.get(id) ?? null;
  }

  list(includeInactive = false): SubjectCatalogEntry[] {
    return [...this.entriesById.values()]
      .filter((entry) => includeInactive || entry.active)
      .sort(
        (left, right) =>
          left.normalizedName.localeCompare(right.normalizedName, 'es') ||
          left.id.localeCompare(right.id),
      );
  }

  get size(): number {
    return this.entriesById.size;
  }
}
