import { IpdeTopicGenerationDiagnostics } from './ipde-catalog-resolution.types';

const EMPTY_DIAGNOSTICS: IpdeTopicGenerationDiagnostics = {
  openAiCalls: 0,
  tokensInput: 0,
  tokensOutput: 0,
  latencyMs: 0,
};

export class IpdeSubjectGenerationUnavailableError extends Error {
  constructor(
    public readonly code: string,
    public readonly diagnostics: IpdeTopicGenerationDiagnostics = EMPTY_DIAGNOSTICS,
  ) {
    super(`IPDE subject generation is unavailable: ${code}`);
    this.name = 'IpdeSubjectGenerationUnavailableError';
  }
}

export class IpdeGeneratedTopicListInvalidError extends Error {
  constructor(public readonly issues: string[]) {
    super('Generated IPDE topic list is invalid');
    this.name = 'IpdeGeneratedTopicListInvalidError';
  }
}

export class IpdeSubjectGenerationAttemptsExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly diagnostics: IpdeTopicGenerationDiagnostics,
  ) {
    super('IPDE subject generation attempts were exhausted');
    this.name = 'IpdeSubjectGenerationAttemptsExhaustedError';
  }
}

export class IpdeUnsafeSubjectInputError extends Error {
  constructor(public readonly code: string) {
    super(`Unsafe IPDE subject input: ${code}`);
    this.name = 'IpdeUnsafeSubjectInputError';
  }
}

export class IpdeCatalogResolutionAmbiguousError extends Error {
  constructor() {
    super('IPDE catalog resolution is ambiguous');
    this.name = 'IpdeCatalogResolutionAmbiguousError';
  }
}

export class IpdeNumericSelectionResolutionError extends Error {
  constructor(public readonly code: string) {
    super(`IPDE numeric selection could not be resolved: ${code}`);
    this.name = 'IpdeNumericSelectionResolutionError';
  }
}

export class IpdeGeneratedCatalogPersistenceError extends Error {
  constructor(
    public readonly diagnostics: IpdeTopicGenerationDiagnostics = EMPTY_DIAGNOSTICS,
  ) {
    super('Generated IPDE catalog entry could not be persisted');
    this.name = 'IpdeGeneratedCatalogPersistenceError';
  }
}
