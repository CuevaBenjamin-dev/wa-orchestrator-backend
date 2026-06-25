export class IpdeMediaAssetsConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpdeMediaAssetsConfigError';
  }
}

export class IpdeMediaSelectionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'IpdeMediaSelectionError';
  }
}

export class IpdeMediaStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpdeMediaStorageError';
  }
}
