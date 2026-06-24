import { resolve } from 'node:path';
import { loadIpdeCommercialBundle } from '../src/ipde-sales/commercial-config/ipde-commercial-config.loader';

async function main(): Promise<void> {
  const commercialConfigPath = resolve(
    process.cwd(),
    process.env.IPDE_COMMERCIAL_CONFIG_PATH?.trim() ||
      './config/ipde/commercial-config.json',
  );
  const modelPdfManifestPath = resolve(
    process.cwd(),
    process.env.IPDE_MODEL_PDF_ASSETS_PATH?.trim() ||
      './config/ipde/model-pdf-assets.json',
  );
  const bundle = await loadIpdeCommercialBundle({
    commercialConfigPath,
    modelPdfManifestPath,
  });
  console.log(
    `IPDE commercial configuration is valid: ${bundle.commercialConfig.issuers.length} issuers, ${bundle.modelPdfManifest.assets.length} model PDF entries`,
  );
}

void main().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'UNKNOWN_ERROR';
  console.error(`IPDE commercial configuration is invalid: ${code}`);
  process.exitCode = 1;
});
