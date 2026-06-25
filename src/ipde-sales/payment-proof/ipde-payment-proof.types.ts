import { z } from 'zod';
import {
  IpdePaymentProofAppliedChangeSchema,
  IpdePaymentProofDetectionInputSchema,
  IpdePaymentProofDetectionResultSchema,
  IpdePaymentProofRegistrationInputSchema,
  IpdePaymentProofRegistrationResultSchema,
} from './ipde-payment-proof.schemas';

export type IpdePaymentProofRegistrationInput = z.infer<
  typeof IpdePaymentProofRegistrationInputSchema
>;

export type IpdePaymentProofRegistrationResult = z.infer<
  typeof IpdePaymentProofRegistrationResultSchema
>;

export type IpdePaymentProofPersistenceResult = Omit<
  IpdePaymentProofRegistrationResult,
  'outboundActions'
>;

export type IpdePaymentProofAppliedChange = z.infer<
  typeof IpdePaymentProofAppliedChangeSchema
>;

export type IpdePaymentProofDetectionInput = z.infer<
  typeof IpdePaymentProofDetectionInputSchema
>;

export type IpdePaymentProofDetectionResult = z.infer<
  typeof IpdePaymentProofDetectionResultSchema
>;
