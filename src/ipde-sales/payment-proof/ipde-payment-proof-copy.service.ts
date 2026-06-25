import { Injectable } from '@nestjs/common';
import { IpdeOutboundAction } from '../conversation-engine/ipde-conversation-action.schemas';

@Injectable()
export class IpdePaymentProofCopyService {
  paymentProofReceived(): IpdeOutboundAction {
    return {
      type: 'PAYMENT_PROOF_RECEIVED',
      messageDraft:
        'Perfecto, ya recibí tu comprobante.\nVamos a verificar que el pago se haya realizado correctamente. Dame un momento, por favor.',
    };
  }
}
