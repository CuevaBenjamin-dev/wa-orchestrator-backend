export interface CatalogValidationIssue {
  path: string;
  message: string;
}

export class ManualCatalogInvalidError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly issues: CatalogValidationIssue[],
    options?: ErrorOptions,
  ) {
    super(`Manual catalog is invalid: ${filePath}`, options);
    this.name = 'ManualCatalogInvalidError';
  }
}

export class GeneratedCatalogEntryInvalidError extends Error {
  constructor(
    public readonly fileName: string,
    public readonly issues: CatalogValidationIssue[],
    options?: ErrorOptions,
  ) {
    super(`Generated catalog entry is invalid: ${fileName}`, options);
    this.name = 'GeneratedCatalogEntryInvalidError';
  }
}

export class PersistentStorageUnavailableError extends Error {
  constructor(
    public readonly operation: string,
    public readonly targetPath: string,
    options?: ErrorOptions,
  ) {
    super(`Persistent storage operation failed: ${operation}`, options);
    this.name = 'PersistentStorageUnavailableError';
  }
}

export class CatalogEntryAlreadyExistsError extends Error {
  constructor(public readonly key: string) {
    super(`A catalog entry already exists for key: ${key}`);
    this.name = 'CatalogEntryAlreadyExistsError';
  }
}

export class UnsafeCatalogPathError extends Error {
  constructor(public readonly attemptedPath: string) {
    super('Catalog path must remain inside the configured storage directory');
    this.name = 'UnsafeCatalogPathError';
  }
}

export class CatalogConfigurationError extends Error {
  constructor(
    public readonly variableName: string,
    message: string,
  ) {
    super(`Invalid catalog configuration for ${variableName}: ${message}`);
    this.name = 'CatalogConfigurationError';
  }
}

export class CatalogJsonValidationError extends Error {
  constructor(public readonly issues: CatalogValidationIssue[]) {
    super('JSON content does not satisfy the catalog schema');
    this.name = 'CatalogJsonValidationError';
  }
}
