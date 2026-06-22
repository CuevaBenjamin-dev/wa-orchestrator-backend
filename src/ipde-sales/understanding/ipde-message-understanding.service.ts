import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OpenAiClientService } from '../../ai/openai-client.service';
import {
  DEFAULT_IPDE_UNDERSTANDING_MODEL,
  DEFAULT_IPDE_UNDERSTANDING_PROMPT_VERSION,
} from './ipde-understanding.constants';
import { IpdeUnderstandingFallbackService } from './ipde-understanding-fallback.service';
import {
  buildIpdeUnderstandingUserContent,
  IPDE_UNDERSTANDING_SYSTEM_PROMPT,
} from './ipde-understanding.prompt';
import {
  IpdeMessageExtractionSchema,
  IpdeMessageUnderstandingInputSchema,
} from './ipde-understanding.schemas';
import {
  IpdeMessageUnderstandingInput,
  IpdeMessageUnderstandingResult,
  IpdeUnderstandingFallbackReason,
} from './ipde-understanding.types';

@Injectable()
export class IpdeMessageUnderstandingService {
  private readonly logger = new Logger(IpdeMessageUnderstandingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly openAiClient: OpenAiClientService,
    private readonly fallback: IpdeUnderstandingFallbackService,
  ) {}

  async understand(
    candidate: IpdeMessageUnderstandingInput,
  ): Promise<IpdeMessageUnderstandingResult> {
    const input = IpdeMessageUnderstandingInputSchema.parse(candidate);
    const promptVersion = this.getPromptVersion();
    const model = this.getModel();
    const client = this.openAiClient.getClient();
    const startedAt = Date.now();
    const requestId = randomUUID();

    if (!client) {
      return this.localFallback({
        input,
        model: null,
        promptVersion,
        startedAt,
        requestId,
        reason: 'API_KEY_MISSING',
      });
    }

    try {
      const response = await client.responses.parse({
        model,
        input: [
          {
            role: 'system',
            content: IPDE_UNDERSTANDING_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildIpdeUnderstandingUserContent(input),
          },
        ],
        text: {
          format: zodTextFormat(
            IpdeMessageExtractionSchema,
            'ipde_message_extraction',
          ),
        },
        max_output_tokens: 2500,
      });

      if (response.output_parsed === null) {
        return this.localFallback({
          input,
          model,
          promptVersion,
          startedAt,
          requestId,
          reason: 'PARSED_OUTPUT_NULL',
        });
      }

      const validation = IpdeMessageExtractionSchema.safeParse(
        response.output_parsed,
      );
      if (!validation.success) {
        return this.localFallback({
          input,
          model,
          promptVersion,
          startedAt,
          requestId,
          reason: 'INVALID_PARSED_OUTPUT',
        });
      }

      return {
        extraction: validation.data,
        metadata: {
          source: 'OPENAI',
          model: response.model ?? model,
          promptVersion,
          tokensInput: response.usage?.input_tokens ?? 0,
          tokensOutput: response.usage?.output_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          usedFallback: false,
        },
      };
    } catch (error) {
      return this.localFallback({
        input,
        model,
        promptVersion,
        startedAt,
        requestId,
        reason: this.classifyError(error),
      });
    }
  }

  private localFallback(params: {
    input: IpdeMessageUnderstandingInput;
    model: string | null;
    promptVersion: string;
    startedAt: number;
    requestId: string;
    reason: IpdeUnderstandingFallbackReason;
  }): IpdeMessageUnderstandingResult {
    const latencyMs = Date.now() - params.startedAt;
    this.logger.warn(
      JSON.stringify({
        event: 'ipde_understanding_fallback',
        requestId: params.requestId,
        model: params.model,
        latencyMs,
        code: params.reason,
        usedFallback: true,
      }),
    );
    return {
      extraction: this.fallback.understand(params.input),
      metadata: {
        source: 'LOCAL_FALLBACK',
        model: params.model,
        promptVersion: params.promptVersion,
        tokensInput: 0,
        tokensOutput: 0,
        latencyMs,
        usedFallback: true,
        fallbackReason: params.reason,
      },
    };
  }

  private getModel(): string {
    return (
      this.configService.get<string>('IPDE_UNDERSTANDING_MODEL')?.trim() ||
      this.configService.get<string>('DEFAULT_OPENAI_MODEL')?.trim() ||
      DEFAULT_IPDE_UNDERSTANDING_MODEL
    );
  }

  private getPromptVersion(): string {
    const promptVersion =
      this.configService
        .get<string>('IPDE_UNDERSTANDING_PROMPT_VERSION')
        ?.trim() || DEFAULT_IPDE_UNDERSTANDING_PROMPT_VERSION;
    return /^[A-Za-z0-9._-]{1,50}$/.test(promptVersion)
      ? promptVersion
      : DEFAULT_IPDE_UNDERSTANDING_PROMPT_VERSION;
  }

  private classifyError(error: unknown): IpdeUnderstandingFallbackReason {
    if (error instanceof APIConnectionTimeoutError) return 'TIMEOUT';
    if (error instanceof AuthenticationError) return 'AUTHENTICATION_ERROR';
    if (error instanceof RateLimitError) return 'RATE_LIMIT';
    if (error instanceof NotFoundError) return 'MODEL_NOT_AVAILABLE';
    if (error instanceof APIConnectionError) return 'NETWORK_ERROR';
    if (error instanceof APIError) return 'SDK_ERROR';
    return 'UNKNOWN_ERROR';
  }
}
