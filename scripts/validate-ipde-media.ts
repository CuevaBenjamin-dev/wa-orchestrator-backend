import { resolve } from 'node:path';
import { loadIpdeMediaAssetsConfig } from '../src/ipde-sales/media/ipde-media-assets.loader';
import { IpdeMediaAssetsConfigError } from '../src/ipde-sales/media/ipde-media-assets.errors';

const DEFAULT_MEDIA_ASSETS_PATH = './config/ipde/media-assets.json';

async function main(): Promise<void> {
  const config = await loadIpdeMediaAssetsConfig(
    resolvePath(process.env.IPDE_MEDIA_ASSETS_PATH, DEFAULT_MEDIA_ASSETS_PATH),
  );
  const activeAssets = config.assets.filter((asset) => asset.active).length;
  console.log(
    `IPDE media assets configuration is valid: ${config.assets.length} assets, ${activeAssets} active`,
  );
}

function resolvePath(value: string | undefined, fallback: string): string {
  return resolve(process.cwd(), value?.trim() || fallback);
}

main().catch((error: unknown) => {
  if (error instanceof IpdeMediaAssetsConfigError) {
    console.error(`${error.code}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error('UNKNOWN_ERROR: IPDE media assets validation failed');
  process.exitCode = 1;
});
