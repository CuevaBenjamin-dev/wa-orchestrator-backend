import { ZodError } from 'zod';
import { IpdePaymentProofRegistrationInputSchema } from './ipde-payment-proof.schemas';

describe('IpdePaymentProofRegistrationInputSchema', () => {
  const validInput = {
    tenantCode: 'IPDE',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    provider: 'WHATSAPP',
    providerMessageId: 'wamid.1',
    providerMediaId: 'media-1',
    mediaType: 'image',
    mimeType: 'image/png',
    caption: 'Comprobante de pago',
    sha256: 'abc123',
  };

  it('accepts a safe WhatsApp image proof reference', () => {
    expect(IpdePaymentProofRegistrationInputSchema.parse(validInput)).toEqual(
      validInput,
    );
  });

  it('rejects dangerous mime types', () => {
    expect(() =>
      IpdePaymentProofRegistrationInputSchema.parse({
        ...validInput,
        mimeType: 'application/x-msdownload',
      }),
    ).toThrow(ZodError);
  });

  it('rejects filenames with path traversal', () => {
    expect(() =>
      IpdePaymentProofRegistrationInputSchema.parse({
        ...validInput,
        mediaType: 'document',
        mimeType: 'application/pdf',
        fileName: '../voucher.pdf',
      }),
    ).toThrow(ZodError);
  });
});
