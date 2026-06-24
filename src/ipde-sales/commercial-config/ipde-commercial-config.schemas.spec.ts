import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import commercialJson from '../../../config/ipde/commercial-config.json';
import modelsJson from '../../../config/ipde/model-pdf-assets.json';
import { IpdeCommercialConfigError } from './ipde-commercial-config.errors';
import { loadIpdeCommercialBundle } from './ipde-commercial-config.loader';
import {
  IpdeCommercialConfigSchema,
  IpdeModelPdfManifestSchema,
} from './ipde-commercial-config.schemas';

describe('IPDE commercial configuration schemas', () => {
  it('validates the authoritative configuration and nine base models', () => {
    expect(
      IpdeCommercialConfigSchema.parse(commercialJson).issuers,
    ).toHaveLength(2);
    expect(IpdeModelPdfManifestSchema.parse(modelsJson).assets).toHaveLength(9);
  });

  it('rejects a duplicate issuer', () => {
    const config = IpdeCommercialConfigSchema.parse(commercialJson);
    config.issuers.push(structuredClone(config.issuers[0]));
    expect(IpdeCommercialConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects a recommendation toward an inactive variant', () => {
    const config = IpdeCommercialConfigSchema.parse(commercialJson);
    config.issuers[0].variants[0].active = false;
    expect(IpdeCommercialConfigSchema.safeParse(config).success).toBe(false);
  });

  it('forbids automatic recommendations and unrelated issuer variants', () => {
    const automatic = structuredClone(commercialJson) as unknown as {
      defaultRule: { recommendation: { autoApply: boolean } };
    };
    automatic.defaultRule.recommendation.autoApply = true;
    expect(IpdeCommercialConfigSchema.safeParse(automatic).success).toBe(false);

    const unrelated = structuredClone(commercialJson) as unknown as {
      issuers: Array<{ variants: Array<{ code: string }> }>;
    };
    unrelated.issuers[0].variants[0].code = 'UNT_DIRECTORAL';
    expect(IpdeCommercialConfigSchema.safeParse(unrelated).success).toBe(false);
  });

  it('rejects a recommendation unavailable for its category', () => {
    const config = IpdeCommercialConfigSchema.parse(commercialJson);
    config.issuers[0].variants[0].availableForCategories = ['EDUCACION'];
    expect(IpdeCommercialConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects unknown products and extra properties', () => {
    const config = structuredClone(commercialJson) as unknown;
    const candidate = config as {
      products: Array<{ code: string }>;
      unexpected?: boolean;
    };
    candidate.products[0].code = 'UNKNOWN_PRODUCT';
    candidate.unexpected = true;
    expect(IpdeCommercialConfigSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects unknown issuer/variant references and dangerous paths', () => {
    const manifest = structuredClone(modelsJson) as unknown as {
      assets: Array<{
        issuerCode: string;
        issuerVariantCode: string;
        fileName: string;
      }>;
    };
    manifest.assets[0].issuerCode = 'UNKNOWN';
    manifest.assets[1].issuerVariantCode = 'UNKNOWN_VARIANT';
    manifest.assets[2].fileName = '../secret.pdf';
    expect(IpdeModelPdfManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejects empty physical references when the optional field is present', () => {
    const manifest = structuredClone(modelsJson) as unknown as {
      assets: Array<{
        fileName: string;
        storageKey?: string;
        publicUrl?: string;
      }>;
    };
    manifest.assets[0].fileName = '';
    manifest.assets[1].storageKey = '';
    manifest.assets[2].publicUrl = '';
    expect(IpdeModelPdfManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('does not require physical PDF files', async () => {
    await expect(
      loadIpdeCommercialBundle({
        commercialConfigPath: join(
          process.cwd(),
          'config/ipde/commercial-config.json',
        ),
        modelPdfManifestPath: join(
          process.cwd(),
          'config/ipde/model-pdf-assets.json',
        ),
      }),
    ).resolves.toBeDefined();
  });

  it('returns a safe error for corrupt JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ipde-commercial-'));
    const commercialPath = join(directory, 'commercial.json');
    const modelsPath = join(directory, 'models.json');
    try {
      await Promise.all([
        writeFile(commercialPath, '{broken', 'utf8'),
        writeFile(modelsPath, JSON.stringify(modelsJson), 'utf8'),
      ]);
      await expect(
        loadIpdeCommercialBundle({
          commercialConfigPath: commercialPath,
          modelPdfManifestPath: modelsPath,
        }),
      ).rejects.toMatchObject<IpdeCommercialConfigError>({
        code: 'COMMERCIAL_CONFIG_INVALID_JSON',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
