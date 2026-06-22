import {
  IpdeMessageExtractionSchema,
  IpdeMessageUnderstandingInputSchema,
} from './ipde-understanding.schemas';
import { IpdeMessageExtraction } from './ipde-understanding.types';

function validExtraction(): IpdeMessageExtraction {
  return {
    schemaVersion: 1,
    primaryIntent: 'PROVIDE_SUBJECTS',
    secondaryIntents: [],
    requestPath: 'CATALOG_LIST',
    subjects: [
      {
        rawText: 'Derecho Civil',
        displayNameCandidate: 'Derecho Civil',
        normalizedNameCandidate: 'derecho civil',
        categoryCandidate: 'DERECHO',
        confidence: 0.95,
        isAcronym: false,
        needsClarification: false,
      },
    ],
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
    overallConfidence: 0.95,
  };
}

describe('IpdeMessageExtractionSchema', () => {
  it('accepts a valid strict extraction', () => {
    expect(IpdeMessageExtractionSchema.parse(validExtraction())).toMatchObject({
      primaryIntent: 'PROVIDE_SUBJECTS',
      requestPath: 'CATALOG_LIST',
    });
  });

  it('rejects unknown intents', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        primaryIntent: 'UNKNOWN_INTENT',
      }),
    ).toThrow();
  });

  it('rejects topic numbers outside 1 through 25', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        topicSelections: [
          {
            rawText: 'la 26',
            subjectReference: 'Derecho Civil',
            selectedNumbers: [26],
            selectedNames: [],
            confidence: 0.8,
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects confidence outside zero through one', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        overallConfidence: 1.1,
      }),
    ).toThrow();
  });

  it('rejects properties outside the contract', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        whatsappReply: 'No debe existir',
      }),
    ).toThrow();
  });

  it('rejects duplicate secondary intents', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        secondaryIntents: ['REQUEST_PRICE', 'REQUEST_PRICE'],
      }),
    ).toThrow();
  });

  it('rejects the primary intent repeated as secondary', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        secondaryIntents: ['PROVIDE_SUBJECTS'],
      }),
    ).toThrow();
  });

  it('rejects duplicate artifacts and topic names', () => {
    expect(() =>
      IpdeMessageExtractionSchema.parse({
        ...validExtraction(),
        requestedArtifacts: ['MODEL_PDF', 'MODEL_PDF'],
        topicSelections: [
          {
            rawText: 'Familia y familia',
            subjectReference: null,
            selectedNumbers: [],
            selectedNames: ['Familia', 'familia'],
            confidence: 0.8,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('IpdeMessageUnderstandingInputSchema', () => {
  it('enforces message and context limits', () => {
    expect(() =>
      IpdeMessageUnderstandingInputSchema.parse({
        tenantCode: 'IPDE',
        userMessage: 'x'.repeat(4001),
      }),
    ).toThrow();
    expect(() =>
      IpdeMessageUnderstandingInputSchema.parse({
        tenantCode: 'IPDE',
        userMessage: 'Hola',
        recentMessages: Array.from({ length: 7 }, () => ({
          role: 'USER',
          content: 'Contexto',
        })),
      }),
    ).toThrow();
  });

  it('rejects unsupported roles and unknown properties', () => {
    expect(() =>
      IpdeMessageUnderstandingInputSchema.parse({
        tenantCode: 'IPDE',
        userMessage: 'Hola',
        recentMessages: [{ role: 'SYSTEM', content: 'No permitido' }],
      }),
    ).toThrow();
    expect(() =>
      IpdeMessageUnderstandingInputSchema.parse({
        tenantCode: 'IPDE',
        userMessage: 'Hola',
        entireConversation: [],
      }),
    ).toThrow();
  });
});
