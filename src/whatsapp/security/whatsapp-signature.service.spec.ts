import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { WhatsappSignatureService } from './whatsapp-signature.service';

describe('WhatsappSignatureService', () => {
  const rawBody = Buffer.from('{"entry":[{"id":"entry-1"}]}', 'utf8');

  it('allows requests when validation is disabled', () => {
    const service = createService({
      WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED: 'false',
    });

    expect(
      service.validate({
        signatureHeader: undefined,
        rawBody: undefined,
      }),
    ).toEqual({ ok: true, status: 'DISABLED' });
  });

  it('accepts a valid sha256 Meta signature', () => {
    const service = createService();

    expect(
      service.validate({
        signatureHeader: signature(rawBody),
        rawBody,
      }),
    ).toEqual({ ok: true, status: 'VALID' });
  });

  it('rejects an invalid signature', () => {
    const service = createService();

    expect(
      service.validate({
        signatureHeader:
          'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        rawBody,
      }),
    ).toEqual({ ok: false, errorCode: 'SIGNATURE_MISMATCH' });
  });

  it('rejects missing and malformed headers when enabled', () => {
    const service = createService();

    expect(
      service.validate({
        signatureHeader: undefined,
        rawBody,
      }),
    ).toEqual({ ok: false, errorCode: 'SIGNATURE_HEADER_MISSING' });
    expect(
      service.validate({
        signatureHeader: 'md5=not-supported',
        rawBody,
      }),
    ).toEqual({ ok: false, errorCode: 'SIGNATURE_FORMAT_INVALID' });
  });

  it('rejects enabled validation without app secret or raw body', () => {
    expect(
      createService({ META_APP_SECRET: '' }).validate({
        signatureHeader: signature(rawBody),
        rawBody,
      }),
    ).toEqual({ ok: false, errorCode: 'APP_SECRET_MISSING' });
    expect(
      createService().validate({
        signatureHeader: signature(rawBody),
        rawBody: undefined,
      }),
    ).toEqual({ ok: false, errorCode: 'RAW_BODY_MISSING' });
  });
});

function createService(
  overrides: Record<string, string> = {},
): WhatsappSignatureService {
  return new WhatsappSignatureService(
    new ConfigService({
      WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED: 'true',
      META_APP_SECRET: 'app-secret',
      ...overrides,
    }),
  );
}

function signature(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', 'app-secret')
    .update(rawBody)
    .digest('hex')}`;
}
