import { readFile } from 'node:fs/promises';
import {
  IpdeCommercialConfigSchema,
  IpdeModelPdfManifestSchema,
} from './ipde-commercial-config.schemas';
import {
  IpdeCommercialConfig,
  IpdeModelPdfManifest,
} from './ipde-commercial-config.types';
import { IpdeCommercialConfigError } from './ipde-commercial-config.errors';

export interface IpdeCommercialBundle {
  commercialConfig: IpdeCommercialConfig;
  modelPdfManifest: IpdeModelPdfManifest;
}

export async function loadIpdeCommercialBundle(params: {
  commercialConfigPath: string;
  modelPdfManifestPath: string;
}): Promise<IpdeCommercialBundle> {
  const [commercialRaw, modelRaw] = await Promise.all([
    readJson(params.commercialConfigPath, 'COMMERCIAL_CONFIG'),
    readJson(params.modelPdfManifestPath, 'MODEL_PDF_MANIFEST'),
  ]);
  const commercial = IpdeCommercialConfigSchema.safeParse(commercialRaw);
  if (!commercial.success) {
    throw new IpdeCommercialConfigError(
      'INVALID_COMMERCIAL_CONFIG',
      formatIssues(commercial.error.issues),
    );
  }
  const manifest = IpdeModelPdfManifestSchema.safeParse(modelRaw);
  if (!manifest.success) {
    throw new IpdeCommercialConfigError(
      'INVALID_MODEL_PDF_MANIFEST',
      formatIssues(manifest.error.issues),
    );
  }
  validateCrossReferences(commercial.data, manifest.data);
  return {
    commercialConfig: commercial.data,
    modelPdfManifest: manifest.data,
  };
}

async function readJson(path: string, label: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    throw new IpdeCommercialConfigError(
      `${label}_NOT_READABLE`,
      `${label} could not be read`,
    );
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new IpdeCommercialConfigError(
      `${label}_INVALID_JSON`,
      `${label} contains invalid JSON`,
    );
  }
}

function validateCrossReferences(
  config: IpdeCommercialConfig,
  manifest: IpdeModelPdfManifest,
): void {
  const variants = new Map<
    string,
    {
      issuerCode: string;
      products: Set<string>;
      issuerActive: boolean;
      variantActive: boolean;
    }
  >();
  for (const issuer of config.issuers) {
    for (const variant of issuer.variants) {
      variants.set(variant.code, {
        issuerCode: issuer.code,
        products: new Set(variant.allowedProductTypes),
        issuerActive: issuer.active,
        variantActive: variant.active,
      });
    }
  }
  for (const asset of manifest.assets) {
    const variant = variants.get(asset.issuerVariantCode);
    if (!variant || variant.issuerCode !== asset.issuerCode) {
      throw new IpdeCommercialConfigError(
        'MODEL_PDF_UNKNOWN_VARIANT',
        `Model PDF ${asset.id} references an unknown issuer variant`,
      );
    }
    if (asset.active && (!variant.issuerActive || !variant.variantActive)) {
      throw new IpdeCommercialConfigError(
        'MODEL_PDF_INACTIVE_VARIANT',
        `Active model PDF ${asset.id} references an inactive issuer variant`,
      );
    }
    if (!variant.products.has(asset.productTypeCode)) {
      throw new IpdeCommercialConfigError(
        'MODEL_PDF_PRODUCT_NOT_ALLOWED',
        `Model PDF ${asset.id} references a product not allowed by its variant`,
      );
    }
  }
}

function formatIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
