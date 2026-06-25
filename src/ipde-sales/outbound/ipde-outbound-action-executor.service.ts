import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpdeCommercialConfigService } from '../commercial-config/ipde-commercial-config.service';
import { IpdeModelPdfAsset } from '../commercial-config/ipde-commercial-config.types';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeMediaAssetsService } from '../media/ipde-media-assets.service';
import {
  IpdeMediaAsset,
  IpdeResolvedMediaSource,
} from '../media/ipde-media-assets.types';
import { IpdeMediaStorageService } from '../media/ipde-media-storage.service';
import { WhatsappMessageGatewayService } from '../../whatsapp/whatsapp-message-gateway.service';
import { WhatsappSendResult } from '../../whatsapp/whatsapp-message-gateway.types';
import {
  IpdeOutboundActionExecutorInput,
  IpdeOutboundExecutionActionResult,
  IpdeOutboundExecutionResult,
} from './ipde-outbound-action-executor.types';

@Injectable()
export class IpdeOutboundActionExecutorService {
  constructor(
    private readonly gateway: WhatsappMessageGatewayService,
    private readonly mediaAssets: IpdeMediaAssetsService,
    private readonly mediaStorage: IpdeMediaStorageService,
    private readonly commercial: IpdeCommercialConfigService,
    private readonly config: ConfigService,
  ) {}

  async execute(
    params: IpdeOutboundActionExecutorInput,
  ): Promise<IpdeOutboundExecutionResult> {
    const actionResults: IpdeOutboundExecutionActionResult[] = [];
    let sequence = 1;
    let stop = false;

    for (const action of params.actions) {
      if (stop) break;
      switch (action.type) {
        case 'NO_AUTOMATED_RESPONSE':
        case 'DEFERRED_COMMERCIAL_REQUEST':
          break;
        case 'PRESENT_TOPIC_LIST':
          for (const chunk of action.chunks) {
            const result = await this.gateway.sendText({
              phoneNumberId: params.phoneNumberId,
              to: params.to,
              text: chunk.text,
            });
            actionResults.push(toActionResult(action.type, sequence++, result));
            if (!result.success) {
              stop = true;
              break;
            }
          }
          break;
        case 'SEND_PAYMENT_METHODS_IMAGE': {
          const text = await this.sendDraft(params, action);
          actionResults.push(toActionResult(action.type, sequence++, text));
          if (!text.success) {
            stop = true;
            break;
          }
          const asset = this.mediaAssets.getAssetById({
            tenantCode: params.tenantCode,
            assetId: action.assetId,
          });
          if (asset) {
            const media = await this.sendImageAsset(params, asset);
            actionResults.push(toActionResult(action.type, sequence++, media));
          }
          break;
        }
        case 'SEND_PROMOTION_IMAGE': {
          const text = await this.sendDraft(params, action);
          actionResults.push(toActionResult(action.type, sequence++, text));
          if (!text.success) {
            stop = true;
            break;
          }
          const asset = this.mediaAssets.getAssetById({
            tenantCode: params.tenantCode,
            assetId: action.assetId,
          });
          if (asset) {
            const media = await this.sendImageAsset(params, asset);
            actionResults.push(toActionResult(action.type, sequence++, media));
          }
          break;
        }
        case 'OFFER_MODEL_PDF_OPTIONS': {
          const text = await this.sendDraft(params, action);
          actionResults.push(toActionResult(action.type, sequence++, text));
          if (!text.success) {
            stop = true;
            break;
          }
          for (const model of action.modelPdfAssets) {
            const asset = this.commercial.getModelPdfAssetById({
              tenantCode: params.tenantCode,
              assetId: model.id,
            });
            if (!asset || !hasModelPdfMedia(asset)) continue;
            const media = await this.sendDocumentAsset(params, asset);
            actionResults.push(toActionResult(action.type, sequence++, media));
          }
          break;
        }
        default: {
          const text = await this.sendDraft(params, action);
          actionResults.push(toActionResult(action.type, sequence++, text));
          if (!text.success) stop = true;
        }
      }
    }

    return {
      attempted: actionResults.some((result) => result.attempted),
      simulated:
        actionResults.length > 0 &&
        actionResults.every((result) => result.simulated),
      actionResults,
    };
  }

  private sendDraft(
    params: IpdeOutboundActionExecutorInput,
    action: Extract<IpdeOutboundAction, { messageDraft: string }>,
  ): Promise<WhatsappSendResult> {
    return this.gateway.sendText({
      phoneNumberId: params.phoneNumberId,
      to: params.to,
      text: action.messageDraft,
    });
  }

  private async sendImageAsset(
    params: IpdeOutboundActionExecutorInput,
    asset: IpdeMediaAsset,
  ): Promise<WhatsappSendResult> {
    const source = this.mediaAssets.resolveMediaSource(asset);
    const resolved = await this.resolveMediaForGateway(params.phoneNumberId, {
      source,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      fallbackMediaId: `dry-run-storage:${asset.id}`,
    });
    if (!resolved.success) return resolved.result;
    return this.gateway.sendImage({
      phoneNumberId: params.phoneNumberId,
      to: params.to,
      mediaId: resolved.mediaId,
      link: resolved.link,
      caption: asset.caption,
    });
  }

  private async sendDocumentAsset(
    params: IpdeOutboundActionExecutorInput,
    asset: IpdeModelPdfAsset,
  ): Promise<WhatsappSendResult> {
    const source = this.modelPdfSource(asset);
    const resolved = await this.resolveMediaForGateway(params.phoneNumberId, {
      source,
      mimeType: 'application/pdf',
      fileName: asset.fileName,
      fallbackMediaId: `dry-run-storage:${asset.id}`,
    });
    if (!resolved.success) return resolved.result;
    return this.gateway.sendDocument({
      phoneNumberId: params.phoneNumberId,
      to: params.to,
      mediaId: resolved.mediaId,
      link: resolved.link,
      caption: asset.title,
      filename: asset.fileName,
    });
  }

  private async resolveMediaForGateway(
    phoneNumberId: string,
    params: {
      source: IpdeResolvedMediaSource;
      mimeType: string;
      fileName?: string;
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
        result: mediaFailure('MEDIA_STORAGE_FILE_NOT_FOUND'),
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

  private sendEnabled(): boolean {
    return this.config.get<string>('WHATSAPP_SEND_ENABLED') === 'true';
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
}

function toActionResult(
  actionType: string,
  sequence: number,
  result: WhatsappSendResult,
): IpdeOutboundExecutionActionResult {
  return {
    actionType,
    sequence,
    attempted: result.attempted,
    success: result.success,
    simulated: result.simulated,
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
  };
}

function mediaFailure(errorCode: string): WhatsappSendResult {
  return {
    attempted: false,
    success: false,
    simulated: false,
    providerMessageId: null,
    errorCode,
    errorMessage: errorCode,
  };
}

function hasModelPdfMedia(asset: IpdeModelPdfAsset): boolean {
  return Boolean(asset.whatsappMediaId || asset.publicUrl || asset.storageKey);
}
