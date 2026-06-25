import { Injectable } from '@nestjs/common';
import { IpdeConversationStage, IpdePaymentStatus } from '@prisma/client';
import { IpdePaymentProofDetectionInputSchema } from './ipde-payment-proof.schemas';
import {
  IpdePaymentProofDetectionInput,
  IpdePaymentProofDetectionResult,
} from './ipde-payment-proof.types';

const PAYMENT_PROOF_KEYWORDS = [
  'comprobante',
  'voucher',
  'pago',
  'yape',
  'plin',
  'transferencia',
  'deposito',
  'constancia',
  'operacion',
];

@Injectable()
export class IpdePaymentProofDetectorService {
  detect(rawInput: unknown): IpdePaymentProofDetectionResult {
    const input = IpdePaymentProofDetectionInputSchema.parse(rawInput);
    if (input.mediaType !== 'image' && input.mediaType !== 'document') {
      return {
        kind: 'NOT_PAYMENT_PROOF',
        confidence: 'NONE',
        reason: 'UNSUPPORTED_MEDIA_TYPE',
        matchedKeywords: [],
      };
    }

    const matchedKeywords = this.matchKeywords(input);
    if (this.hasPaymentContext(input)) {
      return {
        kind: 'CONFIRMED_PAYMENT_PROOF',
        confidence: 'HIGH',
        reason: 'MEDIA_IN_PAYMENT_CONTEXT',
        matchedKeywords,
      };
    }

    if (matchedKeywords.length > 0) {
      return {
        kind: 'POSSIBLE_PAYMENT_PROOF',
        confidence: 'MEDIUM',
        reason: 'KEYWORD_MATCH_WITHOUT_PAYMENT_CONTEXT',
        matchedKeywords,
      };
    }

    return {
      kind: 'POSSIBLE_PAYMENT_PROOF',
      confidence: 'LOW',
      reason: 'MEDIA_WITHOUT_PAYMENT_CONTEXT',
      matchedKeywords: [],
    };
  }

  private hasPaymentContext(input: IpdePaymentProofDetectionInput): boolean {
    return (
      input.hasPaymentContext ||
      input.hasQuotedPrice ||
      input.currentStage === IpdeConversationStage.WAITING_FOR_PAYMENT ||
      input.currentStage === IpdeConversationStage.PAYMENT_UNDER_REVIEW ||
      input.orderPaymentStatus === IpdePaymentStatus.AWAITING_PROOF ||
      input.orderPaymentStatus === IpdePaymentStatus.PROOF_RECEIVED ||
      input.orderPaymentStatus === IpdePaymentStatus.UNDER_REVIEW
    );
  }

  private matchKeywords(input: IpdePaymentProofDetectionInput): string[] {
    const text = normalizeForDetection(
      [input.caption, input.fileName].filter(Boolean).join(' '),
    );
    return PAYMENT_PROOF_KEYWORDS.filter((keyword) => text.includes(keyword));
  }
}

function normalizeForDetection(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es');
}
