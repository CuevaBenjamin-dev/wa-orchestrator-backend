import { UnsafeCatalogPathError } from '../domain/catalog.errors';
import { normalizeCatalogText } from './normalize-catalog-text';

const SAFE_NORMALIZED_NAME = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u;

export function catalogFileName(normalizedName: string): string {
  if (
    normalizedName.includes('..') ||
    normalizedName.includes('/') ||
    normalizedName.includes('\\') ||
    normalizedName.includes('\0') ||
    normalizedName !== normalizeCatalogText(normalizedName) ||
    !SAFE_NORMALIZED_NAME.test(normalizedName)
  ) {
    throw new UnsafeCatalogPathError(normalizedName);
  }

  return `${normalizedName.replace(/ /g, '-')}.json`;
}
