import { IpdeConversationStage } from '@prisma/client';
import { IpdePaymentProofDetectorService } from './ipde-payment-proof-detector.service';

describe('IpdePaymentProofDetectorService', () => {
  const detector = new IpdePaymentProofDetectorService();

  it('confirms media in a payment context even without caption', () => {
    expect(
      detector.detect({
        mediaType: 'image',
        currentStage: IpdeConversationStage.WAITING_FOR_PAYMENT,
      }),
    ).toMatchObject({
      kind: 'CONFIRMED_PAYMENT_PROOF',
      confidence: 'HIGH',
      reason: 'MEDIA_IN_PAYMENT_CONTEXT',
    });
  });

  it('marks keyword media without payment context as possible, not confirmed', () => {
    expect(
      detector.detect({
        mediaType: 'document',
        fileName: 'voucher-yape.pdf',
      }),
    ).toMatchObject({
      kind: 'POSSIBLE_PAYMENT_PROOF',
      confidence: 'MEDIUM',
      reason: 'KEYWORD_MATCH_WITHOUT_PAYMENT_CONTEXT',
      matchedKeywords: ['voucher', 'yape'],
    });
  });

  it('marks media without context or keywords as possible low confidence', () => {
    expect(detector.detect({ mediaType: 'image' })).toMatchObject({
      kind: 'POSSIBLE_PAYMENT_PROOF',
      confidence: 'LOW',
      reason: 'MEDIA_WITHOUT_PAYMENT_CONTEXT',
    });
  });

  it('ignores unsupported media types', () => {
    expect(detector.detect({})).toMatchObject({
      kind: 'NOT_PAYMENT_PROOF',
      confidence: 'NONE',
      reason: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });
});
