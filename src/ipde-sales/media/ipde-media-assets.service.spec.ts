import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpdeMediaSelectionError } from './ipde-media-assets.errors';
import { IpdeMediaAssetsService } from './ipde-media-assets.service';
import { IpdeMediaSelectionService } from './ipde-media-selection.service';
import { IpdeMediaStorageService } from './ipde-media-storage.service';

describe('IpdeMediaAssetsService', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ipde-media-service-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('selects exact promotion assets by category and ignores inactive assets', async () => {
    const service = await createService([
      promotion('PROMO_INACTIVE_DERECHO', 'DERECHO', 200, false),
      promotion('PROMO_DERECHO_GENERAL', 'DERECHO', 100, true),
      promotion('PROMO_OTROS_GENERAL', 'OTROS', 10, true),
    ]);

    expect(
      service.getPromotionImageForCategory({
        tenantCode: 'IPDE',
        categoryCode: 'DERECHO',
      }),
    ).toMatchObject({ id: 'PROMO_DERECHO_GENERAL' });
  });

  it('uses OTROS or ANY as promotion fallback', async () => {
    const service = await createService([
      promotion('PROMO_OTROS_GENERAL', 'OTROS', 10, true),
    ]);

    expect(
      service.getPromotionImageForCategory({
        tenantCode: 'IPDE',
        categoryCode: 'SALUD',
      }),
    ).toMatchObject({ id: 'PROMO_OTROS_GENERAL' });
  });

  it('selects the unique payment methods winner', async () => {
    const service = await createService([
      {
        id: 'PAYMENT_METHODS_GENERAL',
        active: true,
        priority: 100,
        type: 'PAYMENT_METHODS_IMAGE',
        categoryCode: null,
        title: 'Medios de pago',
        storageKey: 'payments/general.png',
        mimeType: 'image/png',
      },
    ]);

    expect(
      service.getPaymentMethodsImage({ tenantCode: 'IPDE' }),
    ).toMatchObject({ id: 'PAYMENT_METHODS_GENERAL' });
  });

  it('throws on real ties for exact promotion selection', async () => {
    const service = await createService([
      promotion('PROMO_DERECHO_A', 'DERECHO', 100, true),
      promotion('PROMO_DERECHO_B', 'DERECHO', 100, true),
    ]);

    expect(() =>
      service.getPromotionImageForCategory({
        tenantCode: 'IPDE',
        categoryCode: 'DERECHO',
      }),
    ).toThrow(IpdeMediaSelectionError);
  });

  it('resolves media source in whatsapp ID, public URL and storage priority order', async () => {
    const service = await createService([
      {
        ...promotion('PROMO_DERECHO_GENERAL', 'DERECHO', 100, true),
        whatsappMediaId: '1234567890',
        publicUrl: 'https://example.com/promo.png',
      },
    ]);
    const asset = service.getAssetById({
      tenantCode: 'IPDE',
      assetId: 'PROMO_DERECHO_GENERAL',
    });
    expect(asset).not.toBeNull();
    expect(service.resolveMediaSource(asset!)).toEqual({
      kind: 'WHATSAPP_MEDIA_ID',
      mediaId: '1234567890',
    });
  });

  async function createService(
    assets: unknown[],
  ): Promise<IpdeMediaAssetsService> {
    const mediaPath = join(directory, 'media-assets.json');
    await writeFile(
      mediaPath,
      JSON.stringify({ schemaVersion: 1, tenantCode: 'IPDE', assets }),
      'utf8',
    );
    const config = new ConfigService({
      IPDE_MEDIA_ASSETS_PATH: mediaPath,
      PERSISTENT_DATA_DIR: directory,
    });
    const service = new IpdeMediaAssetsService(
      config,
      new IpdeMediaSelectionService(),
      new IpdeMediaStorageService(config),
    );
    await service.onModuleInit();
    return service;
  }
});

function promotion(
  id: string,
  categoryCode: string,
  priority: number,
  active: boolean,
): unknown {
  return {
    id,
    active,
    priority,
    type: 'PROMOTION_IMAGE',
    categoryCode,
    title: id,
    storageKey: `promotions/${id.toLowerCase()}.png`,
    mimeType: 'image/png',
  };
}
