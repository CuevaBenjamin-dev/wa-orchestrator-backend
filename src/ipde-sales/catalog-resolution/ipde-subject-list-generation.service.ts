import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  GeneratedSubjectCatalogEntrySchema,
  formatZodIssues,
} from '../../catalog/domain/catalog.schemas';
import {
  PRODUCT_TYPES,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { DEFAULT_IPDE_UNDERSTANDING_MODEL } from '../understanding/ipde-understanding.constants';
import {
  IpdeGeneratedTopicListInvalidError,
  IpdeSubjectGenerationAttemptsExhaustedError,
  IpdeSubjectGenerationUnavailableError,
  IpdeUnsafeSubjectInputError,
} from './ipde-catalog-resolution.errors';
import {
  GeneratedIpdeSubjectEntryResult,
  GenerateIpdeSubjectEntryInput,
  IpdeTopicGenerationDiagnostics,
} from './ipde-catalog-resolution.types';
import { IpdeGeneratedEntryIdService } from './ipde-generated-entry-id.service';
import {
  buildIpdeTopicGenerationUserContent,
  IPDE_TOPIC_GENERATION_SYSTEM_PROMPT,
} from './ipde-topic-generation.prompt';
import {
  GeneratedTopicListSchema,
  GenerateIpdeSubjectEntryInputSchema,
} from './ipde-topic-generation.schemas';

const DEFAULT_PROMPT_VERSION = 'v1';
const DEFAULT_MAX_ATTEMPTS = 2;

@Injectable()
export class IpdeSubjectListGenerationService {
  private readonly logger = new Logger(IpdeSubjectListGenerationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly openAiClient: OpenAiClientService,
    private readonly ids: IpdeGeneratedEntryIdService,
  ) {}

  async generate(
    candidate: GenerateIpdeSubjectEntryInput,
  ): Promise<GeneratedIpdeSubjectEntryResult> {
    const inputValidation =
      GenerateIpdeSubjectEntryInputSchema.safeParse(candidate);
    if (!inputValidation.success) {
      throw new IpdeUnsafeSubjectInputError('INVALID_SUBJECT_CONTRACT');
    }
    const input = inputValidation.data;
    this.assertSafeSubject(input.requestedDisplayName);

    const client = this.openAiClient.getClient();
    if (!client) {
      throw new IpdeSubjectGenerationUnavailableError('API_KEY_MISSING');
    }

    const model = this.getModel();
    const promptVersion = this.getPromptVersion();
    const maxAttempts = this.getMaxAttempts();
    const startedAt = Date.now();
    const diagnostics: IpdeTopicGenerationDiagnostics = {
      openAiCalls: 0,
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
    };
    let repairIssues: string[] = [];
    const subjectId = this.ids.subjectId(input.normalizedName);
    const subjectKey = subjectId.split('_').at(-1) ?? 'UNKNOWN';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        diagnostics.openAiCalls += 1;
        const response = await client.responses.parse({
          model,
          input: [
            { role: 'system', content: IPDE_TOPIC_GENERATION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildIpdeTopicGenerationUserContent(
                input,
                attempt,
                repairIssues,
              ),
            },
          ],
          text: {
            format: zodTextFormat(
              GeneratedTopicListSchema,
              'ipde_generated_topic_list',
            ),
          },
          max_output_tokens: 5000,
        });
        diagnostics.tokensInput += response.usage?.input_tokens ?? 0;
        diagnostics.tokensOutput += response.usage?.output_tokens ?? 0;

        const parsed = GeneratedTopicListSchema.safeParse(
          response.output_parsed,
        );
        if (!parsed.success) {
          repairIssues = formatZodIssues(parsed.error).map(
            (issue) => `${issue.path}: ${issue.message}`,
          );
          throw new IpdeGeneratedTopicListInvalidError(repairIssues);
        }
        if (
          normalizeCatalogText(parsed.data.subjectDisplayName) !==
          input.normalizedName
        ) {
          repairIssues = [
            'subjectDisplayName: must match the requested subject',
          ];
          throw new IpdeGeneratedTopicListInvalidError(repairIssues);
        }

        const now = new Date().toISOString();
        const entry: SubjectCatalogEntry = {
          schemaVersion: 1,
          id: subjectId,
          tenantCode: 'IPDE',
          category: input.categoryCandidate ?? 'OTROS',
          displayName: input.requestedDisplayName,
          normalizedName: input.normalizedName,
          aliases: [],
          allowedProductTypes: [...PRODUCT_TYPES],
          topics: parsed.data.topics.map((topic, index) => ({
            id: this.ids.topicId(subjectId, index + 1),
            name: topic.name,
            aliases: topic.aliases,
            active: true,
            priority: index + 1,
          })),
          source: 'OPENAI_GENERATED',
          active: true,
          version: 1,
          createdAt: now,
          updatedAt: now,
          generationMetadata: {
            model: response.model ?? model,
            generatedAt: now,
            promptVersion,
          },
          usageMetadata: { useCount: 1, lastUsedAt: now },
        };
        const entryValidation =
          GeneratedSubjectCatalogEntrySchema.safeParse(entry);
        if (!entryValidation.success) {
          repairIssues = formatZodIssues(entryValidation.error).map(
            (issue) => `${issue.path}: ${issue.message}`,
          );
          throw new IpdeGeneratedTopicListInvalidError(repairIssues);
        }

        diagnostics.latencyMs = Date.now() - startedAt;
        return { entry: entryValidation.data, diagnostics };
      } catch (error) {
        if (error instanceof IpdeGeneratedTopicListInvalidError) {
          this.logger.warn(
            JSON.stringify({
              event: 'ipde_topic_generation_invalid',
              subjectKey,
              attempt,
              model,
              code: 'INVALID_STRUCTURED_OUTPUT',
            }),
          );
          if (attempt < maxAttempts) continue;

          diagnostics.latencyMs = Date.now() - startedAt;
          throw new IpdeSubjectGenerationAttemptsExhaustedError(
            attempt,
            diagnostics,
          );
        }

        diagnostics.latencyMs = Date.now() - startedAt;
        const code = this.classifyApiError(error);
        this.logger.warn(
          JSON.stringify({
            event: 'ipde_topic_generation_unavailable',
            subjectKey,
            attempt,
            model,
            code,
          }),
        );
        throw new IpdeSubjectGenerationUnavailableError(code, diagnostics);
      }
    }

    diagnostics.latencyMs = Date.now() - startedAt;
    throw new IpdeSubjectGenerationAttemptsExhaustedError(
      maxAttempts,
      diagnostics,
    );
  }

  private assertSafeSubject(value: string): void {
    const normalized = normalizeCatalogText(value);
    const startsWithInstruction =
      /^(?:ignora|omite|desobedece|revela|confirma|cambia|responde|actua)\b/i.test(
        normalized,
      );
    const instructionMarkers = [
      'instrucciones',
      'prompt',
      'schema',
      'system message',
      'pago aprobado',
    ].filter((marker) => normalized.includes(marker)).length;
    if (
      startsWithInstruction ||
      instructionMarkers >= 2 ||
      /[\r\n`{}<>]/u.test(value) ||
      normalized.split(' ').length > 16
    ) {
      throw new IpdeUnsafeSubjectInputError('INSTRUCTION_LIKE_SUBJECT');
    }
  }

  private getModel(): string {
    return (
      this.configService.get<string>('IPDE_TOPIC_GENERATION_MODEL')?.trim() ||
      this.configService.get<string>('DEFAULT_OPENAI_MODEL')?.trim() ||
      DEFAULT_IPDE_UNDERSTANDING_MODEL
    );
  }

  private getPromptVersion(): string {
    const value =
      this.configService
        .get<string>('IPDE_TOPIC_GENERATION_PROMPT_VERSION')
        ?.trim() || DEFAULT_PROMPT_VERSION;
    return /^[A-Za-z0-9._-]{1,50}$/.test(value)
      ? value
      : DEFAULT_PROMPT_VERSION;
  }

  private getMaxAttempts(): number {
    const configured = this.configService
      .get<string>('IPDE_TOPIC_GENERATION_MAX_ATTEMPTS')
      ?.trim();
    if (!configured) return DEFAULT_MAX_ATTEMPTS;
    const value = Number(configured);
    if (!Number.isInteger(value) || value < 1 || value > 3) {
      throw new IpdeSubjectGenerationUnavailableError(
        'INVALID_MAX_ATTEMPTS_CONFIGURATION',
      );
    }
    return value;
  }

  private classifyApiError(error: unknown): string {
    if (error instanceof APIConnectionTimeoutError) return 'TIMEOUT';
    if (error instanceof AuthenticationError) return 'AUTHENTICATION_ERROR';
    if (error instanceof RateLimitError) return 'RATE_LIMIT';
    if (error instanceof NotFoundError) return 'MODEL_NOT_AVAILABLE';
    if (error instanceof APIConnectionError) return 'NETWORK_ERROR';
    if (error instanceof APIError) return 'SDK_ERROR';
    return 'UNKNOWN_ERROR';
  }
}
