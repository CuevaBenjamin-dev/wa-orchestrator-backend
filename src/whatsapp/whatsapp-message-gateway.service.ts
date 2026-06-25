import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  WhatsappDocumentMessageParams,
  WhatsappImageMessageParams,
  WhatsappMediaUploadParams,
  WhatsappMediaUploadResult,
  WhatsappSendResult,
  WhatsappTextMessageParams,
} from './whatsapp-message-gateway.types';

type MetaMessagePayload =
  | {
      messaging_product: 'whatsapp';
      to: string;
      type: 'text';
      text: { preview_url: false; body: string };
    }
  | {
      messaging_product: 'whatsapp';
      to: string;
      type: 'image';
      image:
        | { id: string; caption?: string }
        | { link: string; caption?: string };
    }
  | {
      messaging_product: 'whatsapp';
      to: string;
      type: 'document';
      document:
        | { id: string; caption?: string; filename?: string }
        | { link: string; caption?: string; filename?: string };
    };

@Injectable()
export class WhatsappMessageGatewayService {
  private readonly logger = new Logger(WhatsappMessageGatewayService.name);

  constructor(private readonly config: ConfigService) {}

  async sendText(
    params: WhatsappTextMessageParams,
  ): Promise<WhatsappSendResult> {
    return this.sendMessage({
      phoneNumberId: params.phoneNumberId,
      payload: {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'text',
        text: { preview_url: false, body: params.text },
      },
    });
  }

  async sendImage(
    params: WhatsappImageMessageParams,
  ): Promise<WhatsappSendResult> {
    const media = this.mediaObject(params.mediaId, params.link, params.caption);
    if (!media) return this.invalidMediaSource();
    return this.sendMessage({
      phoneNumberId: params.phoneNumberId,
      payload: {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'image',
        image: media,
      },
    });
  }

  async sendDocument(
    params: WhatsappDocumentMessageParams,
  ): Promise<WhatsappSendResult> {
    const media = this.mediaObject(
      params.mediaId,
      params.link,
      params.caption,
      params.filename,
    );
    if (!media) return this.invalidMediaSource();
    return this.sendMessage({
      phoneNumberId: params.phoneNumberId,
      payload: {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'document',
        document: media,
      },
    });
  }

  async uploadMedia(
    params: WhatsappMediaUploadParams,
  ): Promise<WhatsappMediaUploadResult> {
    if (!this.sendEnabled()) {
      this.logDryRun('media_upload');
      return {
        attempted: false,
        success: true,
        simulated: true,
        providerMediaId: null,
        errorCode: null,
        errorMessage: null,
      };
    }

    const token = this.accessToken();
    if (!token) {
      return {
        attempted: false,
        success: false,
        simulated: false,
        providerMediaId: null,
        errorCode: 'WHATSAPP_ACCESS_TOKEN_NOT_CONFIGURED',
        errorMessage: 'WhatsApp access token is not configured',
      };
    }

    const body = new FormData();
    const bytes = await readFile(params.filePath);
    body.append('messaging_product', 'whatsapp');
    body.append('type', params.mimeType);
    body.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: params.mimeType }),
      basename(params.filePath),
    );

    const response = await this.performFetch({
      url: this.graphUrl(params.phoneNumberId, 'media'),
      token,
      init: { method: 'POST', body },
    });

    if (!response.success) {
      return { ...response, providerMediaId: null };
    }
    const providerMediaId = extractTopLevelId(response.data);
    if (!providerMediaId) {
      return {
        attempted: true,
        success: false,
        simulated: false,
        providerMediaId: null,
        errorCode: 'PROVIDER_MEDIA_ID_MISSING',
        errorMessage: 'Meta response did not include a media ID',
      };
    }
    return {
      attempted: true,
      success: true,
      simulated: false,
      providerMediaId,
      errorCode: null,
      errorMessage: null,
    };
  }

  private async sendMessage(params: {
    phoneNumberId: string;
    payload: MetaMessagePayload;
  }): Promise<WhatsappSendResult> {
    if (!this.sendEnabled()) {
      this.logDryRun(params.payload.type);
      return {
        attempted: false,
        success: true,
        simulated: true,
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
      };
    }

    const token = this.accessToken();
    if (!token) {
      return {
        attempted: false,
        success: false,
        simulated: false,
        providerMessageId: null,
        errorCode: 'WHATSAPP_ACCESS_TOKEN_NOT_CONFIGURED',
        errorMessage: 'WhatsApp access token is not configured',
      };
    }

    const response = await this.performFetch({
      url: this.graphUrl(params.phoneNumberId, 'messages'),
      token,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.payload),
      },
    });

    if (!response.success) {
      return { ...response, providerMessageId: null };
    }

    const providerMessageId = extractMessageId(response.data);
    if (!providerMessageId) {
      return {
        attempted: true,
        success: false,
        simulated: false,
        providerMessageId: null,
        errorCode: 'PROVIDER_MESSAGE_ID_MISSING',
        errorMessage: 'Meta response did not include a message ID',
      };
    }

    return {
      attempted: true,
      success: true,
      simulated: false,
      providerMessageId,
      errorCode: null,
      errorMessage: null,
    };
  }

  private async performFetch(params: {
    url: string;
    token: string;
    init: RequestInit;
  }): Promise<
    | {
        attempted: true;
        success: true;
        simulated: false;
        data: unknown;
        errorCode: null;
        errorMessage: null;
      }
    | {
        attempted: true;
        success: false;
        simulated: false;
        data?: never;
        errorCode: string;
        errorMessage: string;
      }
  > {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const response = await fetch(params.url, {
        ...params.init,
        headers: {
          ...(params.init.headers ?? {}),
          Authorization: `Bearer ${params.token}`,
        },
        signal: controller.signal,
      });
      let data: unknown;
      try {
        data = (await response.json()) as unknown;
      } catch {
        return {
          attempted: true,
          success: false,
          simulated: false,
          errorCode: 'JSON_INVALID',
          errorMessage: 'Meta response JSON could not be parsed',
        };
      }
      if (!response.ok) {
        const errorCode = this.httpErrorCode(response.status);
        this.logger.warn(
          `WhatsApp Graph API returned ${response.status} (${errorCode})`,
        );
        return {
          attempted: true,
          success: false,
          simulated: false,
          errorCode,
          errorMessage: extractMetaErrorMessage(data) ?? 'Meta request failed',
        };
      }
      return {
        attempted: true,
        success: true,
        simulated: false,
        data,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          attempted: true,
          success: false,
          simulated: false,
          errorCode: 'TIMEOUT',
          errorMessage: 'WhatsApp request timed out',
        };
      }
      return {
        attempted: true,
        success: false,
        simulated: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'WhatsApp request failed before receiving a response',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private mediaObject(
    mediaId?: string,
    link?: string,
    caption?: string,
    filename?: string,
  ):
    | { id: string; caption?: string; filename?: string }
    | { link: string; caption?: string; filename?: string }
    | null {
    if ((mediaId && link) || (!mediaId && !link)) return null;
    const extras = {
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
    };
    return mediaId ? { id: mediaId, ...extras } : { link: link!, ...extras };
  }

  private invalidMediaSource(): WhatsappSendResult {
    return {
      attempted: false,
      success: false,
      simulated: false,
      providerMessageId: null,
      errorCode: 'INVALID_MEDIA_SOURCE',
      errorMessage: 'Provide exactly one mediaId or link',
    };
  }

  private graphUrl(phoneNumberId: string, edge: 'messages' | 'media'): string {
    const apiVersion =
      this.config.get<string>('WHATSAPP_API_VERSION')?.trim() || 'v21.0';
    return `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/${edge}`;
  }

  private sendEnabled(): boolean {
    return this.config.get<string>('WHATSAPP_SEND_ENABLED') === 'true';
  }

  private accessToken(): string | null {
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    return token && token !== 'token_de_meta' ? token : null;
  }

  private timeoutMs(): number {
    const raw = Number(
      this.config.get<string>('WHATSAPP_REQUEST_TIMEOUT_MS') ?? '10000',
    );
    if (!Number.isInteger(raw)) return 10_000;
    return Math.min(Math.max(raw, 1_000), 120_000);
  }

  private httpErrorCode(status: number): string {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401 || status === 403) return 'AUTHORIZATION_ERROR';
    if (status === 429) return 'RATE_LIMIT';
    if (status >= 500) return 'META_SERVER_ERROR';
    return 'HTTP_ERROR';
  }

  private logDryRun(kind: string): void {
    if (
      this.config.get<string>('IPDE_WHATSAPP_DRY_RUN_PAYLOAD_LOG') === 'true'
    ) {
      this.logger.log(`WhatsApp dry-run prepared ${kind} payload`);
    }
  }
}

function extractMessageId(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.messages)) return null;
  const first = data.messages[0] as unknown;
  return isRecord(first) && typeof first.id === 'string' ? first.id : null;
}

function extractTopLevelId(data: unknown): string | null {
  return isRecord(data) && typeof data.id === 'string' ? data.id : null;
}

function extractMetaErrorMessage(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.error)) return null;
  const message = data.error.message;
  return typeof message === 'string' ? message.slice(0, 300) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
