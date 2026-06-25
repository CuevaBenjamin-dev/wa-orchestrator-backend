import { Injectable } from '@nestjs/common';
import {
  IpdePaymentProofRegistrationInputSchema,
  IpdePaymentProofRegistrationResultSchema,
} from './ipde-payment-proof.schemas';
import { IpdePaymentProofRegistrationResult } from './ipde-payment-proof.types';
import { IpdePaymentProofCopyService } from './ipde-payment-proof-copy.service';
import { IpdePaymentProofRepository } from './ipde-payment-proof.repository';

@Injectable()
export class IpdePaymentProofService {
  constructor(
    private readonly repository: IpdePaymentProofRepository,
    private readonly copy: IpdePaymentProofCopyService,
  ) {}

  async registerPaymentProof(
    rawInput: unknown,
  ): Promise<IpdePaymentProofRegistrationResult> {
    const input = IpdePaymentProofRegistrationInputSchema.parse(rawInput);
    const persistenceResult = await this.repository.registerPaymentProof(input);
    const outboundActions = persistenceResult.paymentProof.isDuplicate
      ? []
      : [this.copy.paymentProofReceived()];

    return IpdePaymentProofRegistrationResultSchema.parse({
      ...persistenceResult,
      outboundActions,
    });
  }
}
