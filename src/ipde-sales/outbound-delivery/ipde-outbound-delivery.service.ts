import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IpdeOutboundDelivery,
  IpdeOutboundDeliveryStatus,
} from '@prisma/client';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import { WhatsappMessageGatewayService } from '../../whatsapp/whatsapp-message-gateway.service';
import { WhatsappSendResult } from '../../whatsapp/whatsapp-message-gateway.types';
import { IpdeCommercialConfigService } from '../commercial-config/ipde-commercial-config.service';
import { IpdeModelPdfAsset } from '../commercial-config/ipde-commercial-config.types';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeMediaAssetsService } from '../media/ipde-media-assets.service';
import {
  IpdeMediaAsset,
  IpdeResolvedMediaSource,
} from '../media/ipde-media-assets.types';
import { IpdeMediaStorageService } from '../media/ipde-media-storage.service';
import { IpdeOutboundDeliveryError } from './ipde-outbound-delivery.errors';
import { IpdeOutboundDeliveryRepository } from './ipde-outbound-delivery.repository';
import {
  IpdeOutboundDeliveryConfigSchema,
  IpdeOutboundDeliveryPayload,
  IpdeOutboundDeliveryPayloadSchema,
} from './ipde-outbound-delivery.schemas';
import {
  IpdeOutboundDeliveryCreateInput,
  IpdeOutboundDeliveryExecutionInput,
  IpdeOutboundDeliveryExecutionResult,
  IpdeOutboundDeliveryRetryInput,
  IpdePlannedOutboundDelivery,
} from './ipde-outbound-delivery.types';

@Injectable()
export class IpdeOutboundDeliveryService {
  constructor(
    private readonly repository: IpdeOutboundDeliveryRepository,
    private readonly gateway: WhatsappMessageGatewayService,
    private readonly mediaAssets: IpdeMediaAssetsService,
    private readonly mediaStorage: IpdeMediaStorageService,
    private readonly commercial: IpdeCommercialConfigService,
    private readonly config: ConfigService,
  ) {}

  createFromActions(
    params: IpdeOutboundDeliveryCreateInput,
  ): Promise<IpdeOutboundDelivery[]> {
    const planned = planOutboundDeliveries(params.actions);
    if (planned.length === 0) {
      return Promise.resolve([]);
    }

    return this.repository.createFromPlan({
      tenantId: params.tenantId,
      leadId: params.leadId,
      conversationId: params.conversationId,
      orderId: params.orderId,
      inboundMessageId: params.inboundMessageId,
      inboundExternalId: params.inboundExternalId,
      maxAttempts: this.deliveryConfig().maxAttempts,
      planned,
    });
  }

  async executePendingForInbound(
    params: IpdeOutboundDeliveryExecutionInput,
  ): Promise<IpdeOutboundDeliveryExecutionResult> {
    this.requireIpde(params.tenantCode);
    const now = new Date();
    const pending = await this.repository.findExecutableByInbound({
      tenantId: params.tenantId,
      inboundExternalId: params.inboundExternalId,
      now,
    });
    for (const delivery of pending) {
      await this.executeOne(delivery, params);
    }
    const deliveries = await this.repository.findByInbound({
      tenantId: params.tenantId,
      inboundExternalId: params.inboundExternalId,
    });
    return summarizeDeliveries(deliveries, pending.length > 0);
  }

  async retryPending(
    params: IpdeOutboundDeliveryRetryInput,
  ): Promise<IpdeOutboundDeliveryExecutionResult> {
    this.requireIpde(params.tenantCode);
    const pending = await this.repository.findPending({
      tenantId: params.tenantId,
      limit: Math.min(Math.max(params.limit, 1), 100),
      now: new Date(),
    });
    const deliveries: IpdeOutboundDelivery[] = [];
    for (const delivery of pending) {
      if (!delivery.lead?.phone) {
        deliveries.push(
          await this.repository.markFailed({
            id: delivery.id,
            code: 'OUTBOUND_ROUTING_MISSING',
            message: 'Outbound delivery recipient could not be resolved',
            now: new Date(),
          }),
        );
        continue;
      }
      const executed = await this.executeOne(delivery, {
        tenantCode: params.tenantCode,
        phoneNumberId: delivery.tenant.whatsappPhoneId,
        to: delivery.lead.phone,
      });
      if (executed) {
        deliveries.push(executed);
      }
    }
    return summarizeDeliveries(deliveries, pending.length > 0);
  }

  private async executeOne(
    delivery: IpdeOutboundDelivery,
    context: {
      tenantCode: 'IPDE';
      phoneNumberId: string;
      to: string;
    },
  ): Promise<IpdeOutboundDelivery | null> {
    const sending = await this.repository.markSending(delivery.id);
    if (!sending) {
      return null;
    }

    const payloadResult = IpdeOutboundDeliveryPayloadSchema.safeParse(
      sending.payloadJson,
    );
    if (!payloadResult.success) {
      return this.repository.markFailed({
        id: sending.id,
        code: 'INVALID_OUTBOUND_DELIVERY_PAYLOAD',
        message: 'Invalid outbound delivery payload',
        now: new Date(),
      });
    }

    const result = await this.sendPayload({
      tenantCode: context.tenantCode,
      phoneNumberId: context.phoneNumberId,
      to: context.to,
      payload: payloadResult.data,
    });

    if (result.kind === 'SKIPPED') {
      return this.repository.markSkipped({
        id: sending.id,
        code: result.code,
        message: result.message,
      });
    }

    const now = new Date();
    if (result.send.success) {
      return this.repository.markSent({
        id: sending.id,
        providerMessageId: result.send.providerMessageId,
        now,
      });
    }

    const code = result.send.errorCode ?? 'WHATSAPP_SEND_FAILED';
    const message = safeErrorMessage(result.send.errorMessage ?? code);
    if (sending.attemptCount < sending.maxAttempts) {
      return this.repository.markPendingRetry({
        id: sending.id,
        code,
        message,
        scheduledAt: this.nextRetryAt(now),
      });
    }

    return this.repository.markFailed({
      id: sending.id,
      code,
      message,
      now,
    });
  }

  private async sendPayload(params: {
    tenantCode: 'IPDE';
    phoneNumberId: string;
    to: string;
    payload: IpdeOutboundDeliveryPayload;
  }): Promise<
    | { kind: 'SENT'; send: WhatsappSendResult }
    | { kind: 'SKIPPED'; code: string; message: string }
  > {
    if (params.payload.kind === 'TEXT') {
      return {
        kind: 'SENT',
        send: await this.gateway.sendText({
          phoneNumberId: params.phoneNumberId,
          to: params.to,
          text: params.payload.text,
        }),
      };
    }

    if (params.payload.kind === 'IMAGE_ASSET') {
      const asset = this.mediaAssets.getAssetById({
        tenantCode: params.tenantCode,
        assetId: params.payload.assetId,
      });
      if (!asset) {
        return skipped('MEDIA_ASSET_NOT_FOUND');
      }
      return this.sendImageAsset(params.phoneNumberId, params.to, asset);
    }

    const asset = this.commercial.getModelPdfAssetById({
      tenantCode: params.tenantCode,
      assetId: params.payload.modelPdfAssetId,
    });
    if (!asset) {
      return skipped('MODEL_PDF_ASSET_NOT_FOUND');
    }
    if (!hasModelPdfMedia(asset)) {
      return skipped('MODEL_PDF_ASSET_WITHOUT_MEDIA');
    }
    return this.sendDocumentAsset(params.phoneNumberId, params.to, asset);
  }

  private async sendImageAsset(
    phoneNumberId: string,
    to: string,
    asset: IpdeMediaAsset,
  ): Promise<
    | { kind: 'SENT'; send: WhatsappSendResult }
    | { kind: 'SKIPPED'; code: string; message: string }
  > {
    let source: IpdeResolvedMediaSource;
    try {
      source = this.mediaAssets.resolveMediaSource(asset);
    } catch {
      return skipped('MEDIA_ASSET_WITHOUT_SOURCE');
    }
    const resolved = await this.resolveMediaForGateway(phoneNumberId, {
      source,
      mimeType: asset.mimeType,
      fallbackMediaId: `dry-run-storage:${asset.id}`,
    });
    if (!resolved.success) return { kind: 'SENT', send: resolved.result };
    return {
      kind: 'SENT',
      send: await this.gateway.sendImage({
        phoneNumberId,
        to,
        mediaId: resolved.mediaId,
        link: resolved.link,
        caption: asset.caption,
      }),
    };
  }

  private async sendDocumentAsset(
    phoneNumberId: string,
    to: string,
    asset: IpdeModelPdfAsset,
  ): Promise<{ kind: 'SENT'; send: WhatsappSendResult }> {
    const source = this.modelPdfSource(asset);
    const resolved = await this.resolveMediaForGateway(phoneNumberId, {
      source,
      mimeType: 'application/pdf',
      fallbackMediaId: `dry-run-storage:${asset.id}`,
    });
    if (!resolved.success) return { kind: 'SENT', send: resolved.result };
    return {
      kind: 'SENT',
      send: await this.gateway.sendDocument({
        phoneNumberId,
        to,
        mediaId: resolved.mediaId,
        link: resolved.link,
        caption: asset.title,
        filename: asset.fileName,
      }),
    };
  }

  private async resolveMediaForGateway(
    phoneNumberId: string,
    params: {
      source: IpdeResolvedMediaSource;
      mimeType: string;
      fallbackMediaId: string;
    },
  ): Promise<
    | { success: true; mediaId?: string; link?: string }
    | { success: false; result: WhatsappSendResult }
  > {
    if (params.source.kind === 'WHATSAPP_MEDIA_ID') {
      return { success: true, mediaId: params.source.mediaId };
    }
    if (params.source.kind === 'PUBLIC_URL') {
      return { success: true, link: params.source.link };
    }
    if (!this.sendEnabled()) {
      return { success: true, mediaId: params.fallbackMediaId };
    }
    try {
      await this.mediaStorage.assertReadable(params.source.filePath);
    } catch {
      return {
        success: false,
        result: sendFailure('MEDIA_STORAGE_FILE_NOT_FOUND'),
      };
    }
    const upload = await this.gateway.uploadMedia({
      phoneNumberId,
      filePath: params.source.filePath,
      mimeType: params.mimeType,
    });
    if (!upload.success || !upload.providerMediaId) {
      return {
        success: false,
        result: {
          attempted: upload.attempted,
          success: false,
          simulated: upload.simulated,
          providerMessageId: null,
          errorCode: upload.errorCode ?? 'MEDIA_UPLOAD_FAILED',
          errorMessage: upload.errorMessage,
        },
      };
    }
    return { success: true, mediaId: upload.providerMediaId };
  }

  private modelPdfSource(asset: IpdeModelPdfAsset): IpdeResolvedMediaSource {
    if (asset.whatsappMediaId) {
      return { kind: 'WHATSAPP_MEDIA_ID', mediaId: asset.whatsappMediaId };
    }
    if (asset.publicUrl) {
      return { kind: 'PUBLIC_URL', link: asset.publicUrl };
    }
    return {
      kind: 'STORAGE_KEY',
      storageKey: asset.storageKey!,
      filePath: this.mediaStorage.resolveStoragePath(asset.storageKey!),
    };
  }

  private deliveryConfig() {
    return IpdeOutboundDeliveryConfigSchema.parse({
      maxAttempts: this.config.get<string>('IPDE_OUTBOUND_MAX_ATTEMPTS') ?? '3',
      retryDelaySeconds:
        this.config.get<string>('IPDE_OUTBOUND_RETRY_DELAY_SECONDS') ?? '60',
    });
  }

  private nextRetryAt(now: Date): Date {
    return new Date(
      now.getTime() + this.deliveryConfig().retryDelaySeconds * 1000,
    );
  }

  private sendEnabled(): boolean {
    return this.config.get<string>('WHATSAPP_SEND_ENABLED') === 'true';
  }

  private requireIpde(tenantCode: string): void {
    if (tenantCode !== IPDE_TENANT_CODE) {
      throw new IpdeOutboundDeliveryError('INVALID_TENANT_CODE');
    }
  }
}

export function planOutboundDeliveries(
  actions: IpdeOutboundAction[],
): IpdePlannedOutboundDelivery[] {
  const planned: IpdePlannedOutboundDelivery[] = [];
  let sequence = 1;

  for (const action of actions) {
    switch (action.type) {
      case 'NO_AUTOMATED_RESPONSE':
      case 'DEFERRED_COMMERCIAL_REQUEST':
        break;
      case 'PRESENT_TOPIC_LIST':
        for (const chunk of action.chunks) {
          planned.push({
            actionType: action.type,
            sequence: sequence++,
            payload: {
              kind: 'TEXT',
              text: chunk.text,
              contentForMessage: chunk.text,
            },
          });
        }
        break;
      case 'SEND_PAYMENT_METHODS_IMAGE':
        planned.push(
          textDelivery(action.type, sequence++, action.messageDraft),
        );
        planned.push({
          actionType: action.type,
          sequence: sequence++,
          payload: {
            kind: 'IMAGE_ASSET',
            assetId: action.assetId,
            contentForMessage: '[Imagen enviada: medios de pago]',
          },
        });
        break;
      case 'SEND_PROMOTION_IMAGE':
        planned.push(
          textDelivery(action.type, sequence++, action.messageDraft),
        );
        planned.push({
          actionType: action.type,
          sequence: sequence++,
          payload: {
            kind: 'IMAGE_ASSET',
            assetId: action.assetId,
            contentForMessage: '[Imagen enviada: promoción]',
          },
        });
        break;
      case 'OFFER_MODEL_PDF_OPTIONS':
        planned.push(
          textDelivery(action.type, sequence++, action.messageDraft),
        );
        for (const model of action.modelPdfAssets) {
          planned.push({
            actionType: action.type,
            sequence: sequence++,
            payload: {
              kind: 'MODEL_PDF_ASSET',
              modelPdfAssetId: model.id,
              contentForMessage: '[Documento enviado: modelo referencial]',
            },
          });
        }
        break;
      default:
        planned.push(
          textDelivery(action.type, sequence++, action.messageDraft),
        );
    }
  }

  return planned;
}

function textDelivery(
  actionType: string,
  sequence: number,
  text: string,
): IpdePlannedOutboundDelivery {
  return {
    actionType,
    sequence,
    payload: { kind: 'TEXT', text, contentForMessage: text },
  };
}

function summarizeDeliveries(
  deliveries: IpdeOutboundDelivery[],
  attempted: boolean,
): IpdeOutboundDeliveryExecutionResult {
  return {
    attempted,
    sent: deliveries.filter(
      (delivery) => delivery.status === IpdeOutboundDeliveryStatus.SENT,
    ).length,
    failed: deliveries.filter(
      (delivery) => delivery.status === IpdeOutboundDeliveryStatus.FAILED,
    ).length,
    pending: deliveries.filter(
      (delivery) => delivery.status === IpdeOutboundDeliveryStatus.PENDING,
    ).length,
    skipped: deliveries.filter(
      (delivery) => delivery.status === IpdeOutboundDeliveryStatus.SKIPPED,
    ).length,
    deliveries,
  };
}

function skipped(code: string): {
  kind: 'SKIPPED';
  code: string;
  message: string;
} {
  return { kind: 'SKIPPED', code, message: code };
}

function sendFailure(errorCode: string): WhatsappSendResult {
  return {
    attempted: false,
    success: false,
    simulated: false,
    providerMessageId: null,
    errorCode,
    errorMessage: errorCode,
  };
}

function safeErrorMessage(value: string): string {
  return value.slice(0, 300);
}

function hasModelPdfMedia(asset: IpdeModelPdfAsset): boolean {
  return Boolean(asset.whatsappMediaId || asset.publicUrl || asset.storageKey);
}
