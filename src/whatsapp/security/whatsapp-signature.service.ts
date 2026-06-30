import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  WhatsappSignatureFailureCode,
  WhatsappSignatureValidationError,
} from './whatsapp-signature.errors';

export type WhatsappSignatureValidationResult =
  | { ok: true; status: 'DISABLED' | 'VALID' }
  | { ok: false; errorCode: WhatsappSignatureFailureCode };

@Injectable()
export class WhatsappSignatureService {
  private readonly logger = new Logger(WhatsappSignatureService.name);

  constructor(private readonly config: ConfigService) {}

  validate(params: {
    signatureHeader: string | string[] | undefined;
    rawBody: Buffer | string | undefined;
  }): WhatsappSignatureValidationResult {
    if (!this.validationEnabled()) {
      this.logger.log('signature_validation_disabled');
      return { ok: true, status: 'DISABLED' };
    }

    try {
      const secret = this.appSecret();
      const rawBody = this.rawBody(params.rawBody);
      const signature = this.signature(params.signatureHeader);
      const expected = createHmac('sha256', secret).update(rawBody).digest();
      const received = Buffer.from(signature, 'hex');

      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      ) {
        throw new WhatsappSignatureValidationError('SIGNATURE_MISMATCH');
      }

      return { ok: true, status: 'VALID' };
    } catch (error) {
      const errorCode =
        error instanceof WhatsappSignatureValidationError
          ? error.code
          : 'SIGNATURE_MISMATCH';
      this.logger.warn(`signature_validation_failed:${errorCode}`);
      return { ok: false, errorCode };
    }
  }

  private validationEnabled(): boolean {
    return (
      this.config.get<string>(
        'WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED',
      ) === 'true'
    );
  }

  private appSecret(): string {
    const secret = this.config.get<string>('META_APP_SECRET')?.trim();
    if (!secret) {
      throw new WhatsappSignatureValidationError('APP_SECRET_MISSING');
    }
    return secret;
  }

  private rawBody(value: Buffer | string | undefined): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string' && value.length > 0) {
      return Buffer.from(value, 'utf8');
    }
    throw new WhatsappSignatureValidationError('RAW_BODY_MISSING');
  }

  private signature(value: string | string[] | undefined): string {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) {
      throw new WhatsappSignatureValidationError('SIGNATURE_HEADER_MISSING');
    }
    const match = /^sha256=([a-fA-F0-9]{64})$/.exec(header.trim());
    if (!match) {
      throw new WhatsappSignatureValidationError('SIGNATURE_FORMAT_INVALID');
    }
    return match[1];
  }
}
