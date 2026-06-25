import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderStatus,
  IpdePaymentProofStatus,
  IpdePaymentStatus,
} from '@prisma/client';
import { IpdePaymentProofCopyService } from './ipde-payment-proof-copy.service';
import { IpdePaymentProofRepository } from './ipde-payment-proof.repository';
import { IpdePaymentProofService } from './ipde-payment-proof.service';
import { IpdePaymentProofPersistenceResult } from './ipde-payment-proof.types';

describe('IpdePaymentProofService', () => {
  it('returns the deterministic human-review action for a new proof', async () => {
    const repository = {
      registerPaymentProof: jest.fn(() =>
        Promise.resolve(persistenceResult(false)),
      ),
    } as unknown as IpdePaymentProofRepository;
    const service = new IpdePaymentProofService(
      repository,
      new IpdePaymentProofCopyService(),
    );

    const result = await service.registerPaymentProof(input());

    expect(result.outboundActions).toEqual([
      {
        type: 'PAYMENT_PROOF_RECEIVED',
        messageDraft:
          'Perfecto, ya recibí tu comprobante.\nVamos a verificar que el pago se haya realizado correctamente. Dame un momento, por favor.',
      },
    ]);
  });

  it('does not emit another outbound action for duplicate proofs', async () => {
    const repository = {
      registerPaymentProof: jest.fn(() =>
        Promise.resolve(persistenceResult(true)),
      ),
    } as unknown as IpdePaymentProofRepository;
    const service = new IpdePaymentProofService(
      repository,
      new IpdePaymentProofCopyService(),
    );

    const result = await service.registerPaymentProof(input());

    expect(result.paymentProof.isDuplicate).toBe(true);
    expect(result.outboundActions).toEqual([]);
  });
});

function input() {
  return {
    tenantCode: 'IPDE',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    provider: 'WHATSAPP',
    providerMessageId: 'wamid.1',
    providerMediaId: 'media-1',
    mediaType: 'image',
    mimeType: 'image/png',
  };
}

function persistenceResult(
  isDuplicate: boolean,
): IpdePaymentProofPersistenceResult {
  return {
    paymentProof: {
      paymentProofId: 'proof-1',
      status: IpdePaymentProofStatus.UNDER_REVIEW,
      isDuplicate,
      providerMessageId: 'wamid.1',
      providerMediaId: 'media-1',
    },
    order: {
      orderId: 'order-1',
      statusBefore: IpdeOrderStatus.AWAITING_PAYMENT,
      statusAfter: IpdeOrderStatus.PAYMENT_UNDER_REVIEW,
      paymentStatusBefore: IpdePaymentStatus.AWAITING_PROOF,
      paymentStatusAfter: IpdePaymentStatus.UNDER_REVIEW,
    },
    state: {
      stateId: 'state-1',
      stageBefore: IpdeConversationStage.WAITING_FOR_PAYMENT,
      stageAfter: IpdeConversationStage.PAYMENT_UNDER_REVIEW,
      automationModeBefore: IpdeAutomationMode.ACTIVE,
      automationModeAfter: IpdeAutomationMode.PAUSED_HUMAN,
      versionBefore: 1,
      versionAfter: isDuplicate ? 1 : 2,
    },
    appliedChanges: isDuplicate
      ? []
      : [
          { type: 'PAYMENT_PROOF_CREATED', paymentProofId: 'proof-1' },
          { type: 'ORDER_PAYMENT_UNDER_REVIEW', orderId: 'order-1' },
          { type: 'STATE_PAYMENT_UNDER_REVIEW', stateId: 'state-1' },
          { type: 'AUTOMATION_PAUSED', stateId: 'state-1' },
        ],
  };
}
