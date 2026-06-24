import { ConfigService } from '@nestjs/config';
import { IpdeCommercialConfigService } from './ipde-commercial-config.service';
import { IpdeModelPdfSelectionService } from './ipde-model-pdf-selection.service';

describe('IpdeModelPdfSelectionService', () => {
  const commercial = new IpdeCommercialConfigService(new ConfigService());
  const service = new IpdeModelPdfSelectionService(commercial);

  beforeAll(async () => commercial.onModuleInit());

  it('returns one active model per required combination and deduplicates repeats', () => {
    const assets = service.selectForItems({
      tenantCode: 'IPDE',
      items: [
        {
          issuerCode: 'CAC',
          issuerVariantCode: 'CAC_DECANO',
          productTypeCode: 'DIPLOMADO',
          categoryCode: 'DERECHO',
        },
        {
          issuerCode: 'UNT',
          issuerVariantCode: 'UNT_POSGRADO',
          productTypeCode: 'ESPECIALIZACION',
          categoryCode: 'EDUCACION',
        },
        {
          issuerCode: 'UNT',
          issuerVariantCode: 'UNT_POSGRADO',
          productTypeCode: 'ESPECIALIZACION',
          categoryCode: 'EDUCACION',
        },
      ],
    });
    expect(assets.map((asset) => asset.id)).toEqual([
      'MODEL_CAC_DECANO_DIPLOMADO',
      'MODEL_UNT_POSGRADO_ESPECIALIZACION',
    ]);
  });

  it('does not resolve a model until product and issuer are complete', () => {
    expect(
      service.selectForItems({
        tenantCode: 'IPDE',
        items: [
          {
            issuerCode: null,
            issuerVariantCode: null,
            productTypeCode: 'DIPLOMADO',
            categoryCode: 'DERECHO',
          },
        ],
      }),
    ).toEqual([]);
  });
});
