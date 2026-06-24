import { ConfigService } from '@nestjs/config';
import { IpdeMessageExtractionSchema } from '../understanding/ipde-understanding.schemas';
import { IpdeCommercialConfigService } from './ipde-commercial-config.service';
import { IpdeIssuerSelectionService } from './ipde-issuer-selection.service';

function preference(
  issuerCode: 'CAC' | 'UNT' | 'UNSPECIFIED',
  variantCode: 'CAC_DECANO' | 'UNT_DIRECTORAL' | 'UNT_POSGRADO' | 'UNSPECIFIED',
) {
  return IpdeMessageExtractionSchema.parse({
    schemaVersion: 1,
    primaryIntent: 'PROVIDE_ISSUER_PREFERENCE',
    secondaryIntents: [],
    requestPath: 'UNDETERMINED',
    subjects: [],
    topicSelections: [],
    productSelections: [],
    issuerPreference: { issuerCode, variantCode, confidence: 0.9 },
    fullNameCandidate: null,
    requestedArtifacts: [],
    commercialSignals: {
      asksForPrice: false,
      asksForDiscount: false,
      appearsReadyToBuy: false,
      wantsHuman: false,
      mentionsPaymentProof: false,
    },
    confirmation: 'UNCLEAR',
    needsClarification: false,
    ambiguities: [],
    overallConfidence: 0.9,
  }).issuerPreference;
}

describe('IpdeIssuerSelectionService', () => {
  const commercial = new IpdeCommercialConfigService(new ConfigService());
  const service = new IpdeIssuerSelectionService(commercial);

  beforeAll(async () => commercial.onModuleInit());

  it.each([
    ['UNT', 'UNT_POSGRADO'],
    ['UNT', 'UNT_DIRECTORAL'],
    ['CAC', 'CAC_DECANO'],
  ] as const)(
    'validates %s / %s against manual configuration',
    (issuer, variant) => {
      expect(
        service.resolve({
          tenantCode: 'IPDE',
          preference: preference(issuer, variant),
          itemContexts: [
            { categoryCode: 'DERECHO', productTypeCode: 'DIPLOMADO' },
          ],
        }),
      ).toMatchObject({
        kind: 'VALID',
        issuerCode: issuer,
        issuerVariantCode: variant,
      });
    },
  );

  it('asks clarification for an ambiguous issuer', () => {
    const result = service.resolve({
      tenantCode: 'IPDE',
      preference: preference('UNT', 'UNSPECIFIED'),
      itemContexts: [{ categoryCode: 'EDUCACION', productTypeCode: 'CURSO' }],
    });
    expect(result).toMatchObject({ kind: 'CLARIFICATION' });
    if (result.kind === 'CLARIFICATION') {
      expect(result.candidates).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Resolución de posgrado'),
          expect.stringContaining('Resolución directoral'),
        ]),
      );
    }
  });
});
