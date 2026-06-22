import { IpdeCatalogResolutionInputSchema } from './ipde-catalog-resolution.schemas';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';

function extraction(subjectCount: number): IpdeMessageExtraction {
  return {
    schemaVersion: 1,
    primaryIntent: 'PROVIDE_SUBJECTS',
    secondaryIntents: [],
    requestPath: 'CATALOG_LIST',
    subjects: Array.from({ length: subjectCount }, (_, index) => ({
      rawText: `Materia ${index}`,
      displayNameCandidate: `Materia ${index}`,
      normalizedNameCandidate: `materia ${index}`,
      categoryCandidate: 'OTROS',
      confidence: 0.9,
      isAcronym: false,
      needsClarification: false,
    })),
    topicSelections: [],
    productSelections: [],
    issuerPreference: {
      issuerCode: 'UNSPECIFIED',
      variantCode: 'UNSPECIFIED',
      confidence: 0,
    },
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
  };
}

describe('IpdeCatalogResolutionInputSchema', () => {
  it('accepts at most five subjects', () => {
    expect(
      IpdeCatalogResolutionInputSchema.safeParse({
        tenantCode: 'IPDE',
        extraction: extraction(5),
      }).success,
    ).toBe(true);
    expect(
      IpdeCatalogResolutionInputSchema.safeParse({
        tenantCode: 'IPDE',
        extraction: extraction(6),
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate positions and unknown properties', () => {
    const candidate = {
      tenantCode: 'IPDE',
      extraction: extraction(1),
      presentedTopicLists: [
        {
          subjectDisplayName: 'Materia 0',
          topics: [
            { position: 1, topicName: 'Tema Alfa' },
            { position: 1, topicName: 'Tema Beta' },
          ],
        },
      ],
      extra: true,
    };
    expect(IpdeCatalogResolutionInputSchema.safeParse(candidate).success).toBe(
      false,
    );
  });
});
