import { Module } from '@nestjs/common';
import { IpdePaymentProofCopyService } from './ipde-payment-proof-copy.service';
import { IpdePaymentProofDetectorService } from './ipde-payment-proof-detector.service';
import { IpdePaymentProofRepository } from './ipde-payment-proof.repository';
import { IpdePaymentProofService } from './ipde-payment-proof.service';

@Module({
  providers: [
    IpdePaymentProofCopyService,
    IpdePaymentProofDetectorService,
    IpdePaymentProofRepository,
    IpdePaymentProofService,
  ],
  exports: [IpdePaymentProofDetectorService, IpdePaymentProofService],
})
export class IpdePaymentProofModule {}
