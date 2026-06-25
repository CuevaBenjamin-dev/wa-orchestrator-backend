import { ConfigService } from '@nestjs/config';
import { IpdeCommercialConfigService } from '../commercial-config/ipde-commercial-config.service';
import { IpdeModelPdfAsset } from '../commercial-config/ipde-commercial-config.types';
import {
  IpdeOutboundAction,
  IpdeOutboundActionSchema,
} from '../conversation-engine/ipde-conversation-action.schemas';
import { IpdeMediaAssetsService } from '../media/ipde-media-assets.service';
import {
  IpdeMediaAsset,
  IpdeResolvedMediaSource,
} from '../media/ipde-media-assets.types';
import { IpdeMediaStorageService } from '../media/ipde-media-storage.service';
import { WhatsappMessageGatewayService } from '../../whatsapp/whatsapp-message-gateway.service';
import {
  WhatsappDocumentMessageParams,
  WhatsappImageMessageParams,
  WhatsappMediaUploadParams,
  WhatsappMediaUploadResult,
  WhatsappSendResult,
  WhatsappTextMessageParams,
} from '../../whatsapp/whatsapp-message-gateway.types';
import { IpdeOutboundActionExecutorService } from './ipde-outbound-action-executor.service';

describe('IpdeOutboundActionExecutorService', () => {
  it('executes a text action', async () => {
    const harness = createHarness();
    const result = await harness.executor.execute(input([askSubject()]));

    expect(result.actionResults).toEqual([
      expect.objectContaining({
        actionType: 'ASK_SUBJECT',
        sequence: 1,
        success: true,
        simulated: true,
      }),
    ]);
    expect(harness.gateway.sent).toEqual([
      { kind: 'text', text: '¿Qué materia necesitas?' },
    ]);
  });

  it('executes the payment proof received action as a dry-run text', async () => {
    const harness = createHarness();
    const result = await harness.executor.execute(
      input([
        IpdeOutboundActionSchema.parse({
          type: 'PAYMENT_PROOF_RECEIVED',
          messageDraft:
            'Perfecto, ya recibí tu comprobante.\nVamos a verificar que el pago se haya realizado correctamente. Dame un momento, por favor.',
        }),
      ]),
    );

    expect(result.actionResults).toEqual([
      expect.objectContaining({
        actionType: 'PAYMENT_PROOF_RECEIVED',
        sequence: 1,
        success: true,
        simulated: true,
      }),
    ]);
    expect(harness.gateway.sent).toEqual([
      {
        kind: 'text',
        text: 'Perfecto, ya recibí tu comprobante.\nVamos a verificar que el pago se haya realizado correctamente. Dame un momento, por favor.',
      },
    ]);
  });

  it('executes topic list chunks in order', async () => {
    const harness = createHarness();
    const result = await harness.executor.execute(
      input([
        IpdeOutboundActionSchema.parse({
          type: 'PRESENT_TOPIC_LIST',
          subjectCatalogEntryId: 'SUBJECT_1',
          subjectDisplayName: 'Derecho Civil',
          source: 'MANUAL',
          topics: Array.from({ length: 25 }, (_value, index) => ({
            position: index + 1,
            topicId: `TOPIC_${index + 1}`,
            topicName: `Tema ${index + 1}`,
          })),
          chunks: [
            { sequence: 1, text: 'chunk uno' },
            { sequence: 2, text: 'chunk dos' },
          ],
          messageDraft: 'chunk uno\n\nchunk dos',
        }),
      ]),
    );

    expect(result.actionResults.map((item) => item.sequence)).toEqual([1, 2]);
    expect(harness.gateway.sent.map((item) => item.text)).toEqual([
      'chunk uno',
      'chunk dos',
    ]);
  });

  it('executes payment methods as text then image', async () => {
    const asset = imageAsset('PAYMENT_METHODS_GENERAL', 'payment-media-id');
    const harness = createHarness({ mediaAssets: [asset] });

    await harness.executor.execute(
      input([
        IpdeOutboundActionSchema.parse({
          type: 'SEND_PAYMENT_METHODS_IMAGE',
          assetId: asset.id,
          messageDraft: 'Claro, te envío los medios de pago disponibles.',
        }),
      ]),
    );

    expect(harness.gateway.sent).toEqual([
      { kind: 'text', text: 'Claro, te envío los medios de pago disponibles.' },
      { kind: 'image', mediaId: 'payment-media-id', link: undefined },
    ]);
  });

  it('executes promotion as text then image', async () => {
    const asset = imageAsset('PROMO_DERECHO_GENERAL', 'promo-media-id');
    const harness = createHarness({ mediaAssets: [asset] });

    await harness.executor.execute(
      input([
        IpdeOutboundActionSchema.parse({
          type: 'SEND_PROMOTION_IMAGE',
          assetId: asset.id,
          categoryCode: 'DERECHO',
          messageDraft: 'Claro, te comparto la promoción disponible.',
        }),
      ]),
    );

    expect(harness.gateway.sent).toEqual([
      { kind: 'text', text: 'Claro, te comparto la promoción disponible.' },
      { kind: 'image', mediaId: 'promo-media-id', link: undefined },
    ]);
  });

  it('offers model PDF text and sends documents only when media exists', async () => {
    const modelWithMedia = modelAsset({
      id: 'MODEL_WITH_MEDIA',
      whatsappMediaId: 'model-media-id',
    });
    const placeholder = modelAsset({ id: 'MODEL_PLACEHOLDER' });
    const harness = createHarness({
      modelAssets: [modelWithMedia, placeholder],
    });

    await harness.executor.execute(
      input([
        IpdeOutboundActionSchema.parse({
          type: 'OFFER_MODEL_PDF_OPTIONS',
          modelPdfAssets: [
            publicModel(modelWithMedia.id),
            publicModel(placeholder.id),
          ],
          messageDraft: 'Tengo modelos disponibles.',
        }),
      ]),
    );

    expect(harness.gateway.sent).toEqual([
      { kind: 'text', text: 'Tengo modelos disponibles.' },
      {
        kind: 'document',
        mediaId: 'model-media-id',
        link: undefined,
        filename: 'modelo.pdf',
      },
    ]);
  });

  it('sends model PDFs by public link when configured', async () => {
    const modelWithLink = modelAsset({
      id: 'MODEL_WITH_LINK',
      publicUrl: 'https://example.com/modelo.pdf',
    });
    const harness = createHarness({ modelAssets: [modelWithLink] });

    await harness.executor.execute(
      input([
        IpdeOutboundActionSchema.parse({
          type: 'OFFER_MODEL_PDF_OPTIONS',
          modelPdfAssets: [publicModel(modelWithLink.id)],
          messageDraft: 'Tengo modelos disponibles.',
        }),
      ]),
    );

    expect(harness.gateway.sent[1]).toEqual({
      kind: 'document',
      mediaId: undefined,
      link: 'https://example.com/modelo.pdf',
      filename: 'modelo.pdf',
    });
  });

  it('stops following actions when a primary text send fails', async () => {
    const harness = createHarness({ failText: true });
    const result = await harness.executor.execute(
      input([askSubject(), askSubject()]),
    );

    expect(result.actionResults).toHaveLength(1);
    expect(result.actionResults[0]).toMatchObject({
      actionType: 'ASK_SUBJECT',
      success: false,
      errorCode: 'TEXT_FAILED',
    });
    expect(harness.gateway.sent).toEqual([
      { kind: 'text', text: '¿Qué materia necesitas?' },
    ]);
  });

  function createHarness(
    params: {
      mediaAssets?: IpdeMediaAsset[];
      modelAssets?: IpdeModelPdfAsset[];
      failText?: boolean;
    } = {},
  ) {
    const gateway = new FakeGateway(params.failText);
    const mediaAssets = new FakeMediaAssets(params.mediaAssets ?? []);
    const commercial = new FakeCommercial(params.modelAssets ?? []);
    const storage = new FakeMediaStorage();
    const executor = new IpdeOutboundActionExecutorService(
      gateway as unknown as WhatsappMessageGatewayService,
      mediaAssets as unknown as IpdeMediaAssetsService,
      storage as unknown as IpdeMediaStorageService,
      commercial as unknown as IpdeCommercialConfigService,
      new ConfigService({ WHATSAPP_SEND_ENABLED: 'false' }),
    );
    return { executor, gateway };
  }
});

class FakeGateway {
  readonly sent: Array<{
    kind: 'text' | 'image' | 'document';
    text?: string;
    mediaId?: string;
    link?: string;
    filename?: string;
  }> = [];

  constructor(private readonly failText = false) {}

  sendText(params: WhatsappTextMessageParams): Promise<WhatsappSendResult> {
    this.sent.push({ kind: 'text', text: params.text });
    return Promise.resolve(
      this.failText
        ? result(false, 'TEXT_FAILED')
        : result(true, null, 'wamid.text'),
    );
  }

  sendImage(params: WhatsappImageMessageParams): Promise<WhatsappSendResult> {
    this.sent.push({
      kind: 'image',
      mediaId: params.mediaId,
      link: params.link,
    });
    return Promise.resolve(result(true, null, 'wamid.image'));
  }

  sendDocument(
    params: WhatsappDocumentMessageParams,
  ): Promise<WhatsappSendResult> {
    this.sent.push({
      kind: 'document',
      mediaId: params.mediaId,
      link: params.link,
      filename: params.filename,
    });
    return Promise.resolve(result(true, null, 'wamid.document'));
  }

  uploadMedia(
    params: WhatsappMediaUploadParams,
  ): Promise<WhatsappMediaUploadResult> {
    void params;
    return Promise.resolve({
      attempted: false,
      success: true,
      simulated: true,
      providerMediaId: 'uploaded-media-id',
      errorCode: null,
      errorMessage: null,
    });
  }
}

class FakeMediaAssets {
  constructor(private readonly assets: IpdeMediaAsset[]) {}

  getAssetById(params: { tenantCode: 'IPDE'; assetId: string }) {
    return this.assets.find((asset) => asset.id === params.assetId) ?? null;
  }

  resolveMediaSource(asset: IpdeMediaAsset): IpdeResolvedMediaSource {
    if (asset.whatsappMediaId) {
      return { kind: 'WHATSAPP_MEDIA_ID', mediaId: asset.whatsappMediaId };
    }
    if (asset.publicUrl) {
      return { kind: 'PUBLIC_URL', link: asset.publicUrl };
    }
    return {
      kind: 'STORAGE_KEY',
      storageKey: asset.storageKey!,
      filePath: asset.storageKey!,
    };
  }
}

class FakeCommercial {
  constructor(private readonly assets: IpdeModelPdfAsset[]) {}

  getModelPdfAssetById(params: { tenantCode: 'IPDE'; assetId: string }) {
    return this.assets.find((asset) => asset.id === params.assetId) ?? null;
  }
}

class FakeMediaStorage {
  resolveStoragePath(storageKey: string): string {
    return storageKey;
  }

  assertReadable(filePath: string): Promise<void> {
    void filePath;
    return Promise.resolve();
  }
}

function input(actions: IpdeOutboundAction[]) {
  return {
    tenantCode: 'IPDE' as const,
    tenantId: 'tenant-1',
    phoneNumberId: 'phone-id',
    to: '51999999999',
    actions,
  };
}

function askSubject(): IpdeOutboundAction {
  return IpdeOutboundActionSchema.parse({
    type: 'ASK_SUBJECT',
    messageDraft: '¿Qué materia necesitas?',
  });
}

function imageAsset(id: string, whatsappMediaId: string): IpdeMediaAsset {
  return {
    id,
    active: true,
    priority: 100,
    type: 'PAYMENT_METHODS_IMAGE',
    categoryCode: null,
    title: id,
    whatsappMediaId,
    mimeType: 'image/png',
  };
}

function modelAsset(params: {
  id: string;
  whatsappMediaId?: string;
  publicUrl?: string;
}): IpdeModelPdfAsset {
  return {
    id: params.id,
    tenantCode: 'IPDE',
    issuerCode: 'UNT',
    issuerVariantCode: 'UNT_POSGRADO',
    productTypeCode: 'DIPLOMADO',
    title: 'Modelo',
    description: 'Modelo referencial',
    fileName: 'modelo.pdf',
    active: true,
    priority: 1,
    ...(params.whatsappMediaId
      ? { whatsappMediaId: params.whatsappMediaId }
      : {}),
    ...(params.publicUrl ? { publicUrl: params.publicUrl } : {}),
  };
}

function publicModel(id: string) {
  return {
    id,
    title: 'Modelo',
    description: 'Modelo referencial',
    issuerCode: 'UNT',
    issuerVariantCode: 'UNT_POSGRADO',
    productTypeCode: 'DIPLOMADO',
  };
}

function result(
  success: boolean,
  errorCode: string | null,
  providerMessageId: string | null = null,
): WhatsappSendResult {
  return {
    attempted: false,
    success,
    simulated: true,
    providerMessageId,
    errorCode,
    errorMessage: errorCode,
  };
}
