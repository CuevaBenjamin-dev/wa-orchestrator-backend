import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 10_000;
const MIN_OPENAI_REQUEST_TIMEOUT_MS = 1_000;
const MAX_OPENAI_REQUEST_TIMEOUT_MS = 120_000;

export class OpenAiConfigurationError extends Error {
  constructor(public readonly variableName: string) {
    super(`Invalid OpenAI configuration: ${variableName}`);
    this.name = 'OpenAiConfigurationError';
  }
}

@Injectable()
export class OpenAiClientService {
  private readonly client: OpenAI | null;
  readonly requestTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.requestTimeoutMs = this.readRequestTimeout();
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    this.client = apiKey
      ? new OpenAI({
          apiKey,
          timeout: this.requestTimeoutMs,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): OpenAI | null {
    return this.client;
  }

  private readRequestTimeout(): number {
    const configured = this.configService
      .get<string>('OPENAI_REQUEST_TIMEOUT_MS')
      ?.trim();
    if (!configured) {
      return DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
    }

    const timeout = Number(configured);
    if (
      !Number.isInteger(timeout) ||
      timeout < MIN_OPENAI_REQUEST_TIMEOUT_MS ||
      timeout > MAX_OPENAI_REQUEST_TIMEOUT_MS
    ) {
      throw new OpenAiConfigurationError('OPENAI_REQUEST_TIMEOUT_MS');
    }
    return timeout;
  }
}
