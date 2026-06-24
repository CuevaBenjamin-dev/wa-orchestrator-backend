import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import commercialJson from '../../../config/ipde/commercial-config.json';
import modelsJson from '../../../config/ipde/model-pdf-assets.json';
import { IpdeCommercialConfigService } from './ipde-commercial-config.service';
import { IpdeProductLabelService } from './ipde-product-label.service';

describe('IpdeCommercialConfigService', () => {
  const service = new IpdeCommercialConfigService(new ConfigService());

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it.each([
    ['DERECHO', 'CAC', 'CAC_DECANO'],
    ['EDUCACION', 'UNT', 'UNT_POSGRADO'],
    ['GESTION_PUBLICA', 'UNT', 'UNT_POSGRADO'],
    ['SALUD', 'UNT', 'UNT_POSGRADO'],
    ['INGENIERIA', 'UNT', 'UNT_POSGRADO'],
    ['OTROS', 'UNT', 'UNT_POSGRADO'],
  ])('recommends the configured issuer for %s', (category, issuer, variant) => {
    expect(
      service.getRecommendedIssuerVariant({
        tenantCode: 'IPDE',
        categoryCode: category,
        productTypeCode: 'DIPLOMADO',
      }),
    ).toMatchObject({
      issuerCode: issuer,
      variantCode: variant,
      recommended: true,
      autoApply: false,
    });
  });

  it('keeps UNT Directoral and CAC as active alternatives', () => {
    const options = service.getIssuerOptions({
      tenantCode: 'IPDE',
      categoryCode: 'EDUCACION',
      productTypeCode: 'CURSO',
    });
    expect(options.map((option) => option.variantCode)).toEqual(
      expect.arrayContaining(['UNT_POSGRADO', 'UNT_DIRECTORAL', 'CAC_DECANO']),
    );
  });

  it('uses category product rules without blocking Derecho specialization', () => {
    expect(
      service.getAllowedProductTypesForCategory({
        tenantCode: 'IPDE',
        categoryCode: 'DERECHO',
      }),
    ).toEqual(['DIPLOMADO', 'ESPECIALIZACION', 'CURSO']);
    expect(
      service.getAllowedProductTypesForCategory({
        tenantCode: 'IPDE',
        categoryCode: 'SALUD',
      }),
    ).toHaveLength(6);
  });

  it('maps course derivatives to the base course model', () => {
    const assets = service.getModelPdfOptions({
      tenantCode: 'IPDE',
      issuerCode: 'UNT',
      issuerVariantCode: 'UNT_POSGRADO',
      productTypeCode: 'CURSO_CAPACITACION',
      categoryCode: 'SALUD',
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: 'MODEL_UNT_POSGRADO_CURSO',
      productTypeCode: 'CURSO',
    });
  });

  it('does not expose an inactive model asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ipde-model-inactive-'));
    const commercialPath = join(directory, 'commercial.json');
    const modelsPath = join(directory, 'models.json');
    const manifest = structuredClone(modelsJson);
    manifest.assets[0].active = false;
    try {
      await Promise.all([
        writeFile(commercialPath, JSON.stringify(commercialJson), 'utf8'),
        writeFile(modelsPath, JSON.stringify(manifest), 'utf8'),
      ]);
      const isolated = new IpdeCommercialConfigService(
        new ConfigService({
          IPDE_COMMERCIAL_CONFIG_PATH: commercialPath,
          IPDE_MODEL_PDF_ASSETS_PATH: modelsPath,
        }),
      );
      await isolated.onModuleInit();
      expect(
        isolated.getModelPdfOptions({
          tenantCode: 'IPDE',
          issuerCode: 'CAC',
          issuerVariantCode: 'CAC_DECANO',
          productTypeCode: 'DIPLOMADO',
          categoryCode: 'DERECHO',
        }),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns natural centralized product labels', () => {
    const labels = new IpdeProductLabelService();
    expect(
      labels.getLabels([
        'DIPLOMADO',
        'ESPECIALIZACION',
        'CURSO_CAPACITACION',
        'CURSO_ACTUALIZACION',
        'CURSO_ESPECIALIZACION',
      ]),
    ).toEqual([
      'Diplomado',
      'Especialización',
      'Curso de capacitación',
      'Curso de actualización',
      'Curso de especialización',
    ]);
  });
});
