export function isFinalCatalogJsonFile(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return (
    normalized.endsWith('.json') &&
    !normalized.startsWith('.') &&
    !normalized.includes('.tmp') &&
    !normalized.includes('.temp') &&
    !normalized.includes('.backup') &&
    !normalized.includes('.bak') &&
    !normalized.endsWith('~.json')
  );
}
