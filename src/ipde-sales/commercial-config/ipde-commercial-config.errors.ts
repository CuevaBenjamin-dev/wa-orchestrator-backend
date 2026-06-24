export class IpdeCommercialConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpdeCommercialConfigError';
  }
}

export class IpdeCommercialSelectionError extends Error {
  constructor(public readonly code: string) {
    super(`Invalid IPDE commercial selection: ${code}`);
    this.name = 'IpdeCommercialSelectionError';
  }
}
