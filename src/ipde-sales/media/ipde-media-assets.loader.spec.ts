import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIpdeMediaAssetsConfig } from './ipde-media-assets.loader';
import { IpdeMediaAssetsConfigError } from './ipde-media-assets.errors';

describe('loadIpdeMediaAssetsConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipde-media-loader-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a valid config', async () => {
    const path = writeConfig(validConfig());
    await expect(loadIpdeMediaAssetsConfig(path)).resolves.toMatchObject({
      assets: [expect.objectContaining({ id: 'PROMO_DERECHO_GENERAL' })],
    });
  });

  it('fails with a structured error for corrupt JSON', async () => {
    const path = join(dir, 'media-assets.json');
    writeFileSync(path, '{', 'utf8');
    await expect(
      loadIpdeMediaAssetsConfig(path),
    ).rejects.toMatchObject<IpdeMediaAssetsConfigError>({
      code: 'MEDIA_ASSETS_CONFIG_INVALID_JSON',
    });
  });

  function writeConfig(value: unknown): string {
    const path = join(dir, 'media-assets.json');
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
    return path;
  }
});

function validConfig(): unknown {
  return {
    schemaVersion: 1,
    tenantCode: 'IPDE',
    assets: [
      {
        id: 'PROMO_DERECHO_GENERAL',
        active: true,
        priority: 10,
        type: 'PROMOTION_IMAGE',
        categoryCode: 'DERECHO',
        title: 'Promoción Derecho',
        storageKey: 'promotions/derecho.png',
        mimeType: 'image/png',
      },
    ],
  };
}
