import { IpdeMediaAssetsConfigSchema } from './ipde-media-assets.schemas';

const baseAsset = {
  id: 'PROMO_DERECHO_GENERAL',
  active: true,
  priority: 10,
  type: 'PROMOTION_IMAGE',
  categoryCode: 'DERECHO',
  title: 'Promoción Derecho',
  storageKey: 'promotions/derecho.png',
  mimeType: 'image/png',
};

function config(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    tenantCode: 'IPDE',
    assets: [baseAsset],
    ...overrides,
  };
}

describe('IpdeMediaAssetsConfigSchema', () => {
  it('accepts a valid strict media assets config', () => {
    expect(IpdeMediaAssetsConfigSchema.parse(config()).assets).toHaveLength(1);
  });

  it('rejects duplicated asset IDs', () => {
    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [
            baseAsset,
            {
              ...baseAsset,
              priority: 1,
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects HTTP URLs and URLs with credentials', () => {
    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [
            {
              ...baseAsset,
              storageKey: undefined,
              publicUrl: 'http://example.com/promo.png',
            },
          ],
        }),
      ),
    ).toThrow();

    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [
            {
              ...baseAsset,
              storageKey: undefined,
              publicUrl: 'https://user:pass@example.com/promo.png',
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects unsafe storage keys and absolute paths', () => {
    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [{ ...baseAsset, storageKey: '../secret.png' }],
        }),
      ),
    ).toThrow();

    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [{ ...baseAsset, storageKey: 'C:/secret.png' }],
        }),
      ),
    ).toThrow();
  });

  it('rejects assets without a media source', () => {
    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [
            {
              ...baseAsset,
              storageKey: undefined,
              publicUrl: undefined,
              whatsappMediaId: undefined,
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects unknown categories and fields outside the contract', () => {
    expect(() =>
      IpdeMediaAssetsConfigSchema.parse(
        config({
          assets: [{ ...baseAsset, categoryCode: 'NO_EXISTE' }],
        }),
      ),
    ).toThrow();

    expect(() =>
      IpdeMediaAssetsConfigSchema.parse({
        ...config(),
        unexpected: true,
      }),
    ).toThrow();
  });
});
