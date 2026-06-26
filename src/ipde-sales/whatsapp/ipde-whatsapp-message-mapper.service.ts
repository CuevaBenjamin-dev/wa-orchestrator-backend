import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPDE_TENANT_CODE } from '../../catalog/domain/catalog.types';
import {
  WhatsappIncomingMediaMessage,
  WhatsappIncomingMediaMessageType,
} from '../../whatsapp/whatsapp-media-message.types';
import {
  extractWhatsappIncomingMediaMessage,
  isWhatsappPaymentProofSupportedMediaType,
} from '../../whatsapp/whatsapp-media-message.utils';
import {
  IpdeWhatsappTenant,
  IpdeWhatsappTextMessage,
} from './ipde-whatsapp.types';

@Injectable()
export class IpdeWhatsappMessageMapperService {
  constructor(private readonly config: ConfigService) {}

  canHandleTenant(params: {
    tenant: unknown;
    phoneNumberId: unknown;
  }): boolean {
    if (this.configuredTenantCode() !== IPDE_TENANT_CODE) {
      return false;
    }

    const expectedPhoneNumberId = this.config
      .get<string>('IPDE_WHATSAPP_PHONE_ID')
      ?.trim();
    if (!expectedPhoneNumberId) {
      return false;
    }

    const phoneNumberId = asNonEmptyString(params.phoneNumberId);
    const tenant = this.toTenant(params.tenant);
    return (
      expectedPhoneNumberId === phoneNumberId ||
      expectedPhoneNumberId === tenant?.whatsappPhoneId
    );
  }

  toTenant(value: unknown): IpdeWhatsappTenant | null {
    const record = asRecord(value);
    const id = asNonEmptyString(record?.id);
    const name = asNonEmptyString(record?.name);
    const businessType = asNonEmptyString(record?.businessType);
    const whatsappPhoneId = asNonEmptyString(record?.whatsappPhoneId);
    const status = asNonEmptyString(record?.status);
    if (!id || !name || !businessType || !whatsappPhoneId || !status) {
      return null;
    }

    return value as IpdeWhatsappTenant;
  }

  mapTextMessage(message: unknown): IpdeWhatsappTextMessage | null {
    const payload = asRecord(message);
    if (payload?.type !== 'text') return null;

    const textPayload = asRecord(payload.text);
    const providerMessageId = asNonEmptyString(payload.id);
    const from = asNonEmptyString(payload.from);
    const text = asNonEmptyString(textPayload?.body);
    if (!providerMessageId || !from || !text) return null;

    return { providerMessageId, from, text };
  }

  mapMediaMessage(message: unknown): WhatsappIncomingMediaMessage | null {
    return extractWhatsappIncomingMediaMessage(message);
  }

  getProviderMessageId(message: unknown): string | null {
    return asNonEmptyString(asRecord(message)?.id) ?? null;
  }

  getMessageType(message: unknown): string | null {
    return asNonEmptyString(asRecord(message)?.type) ?? null;
  }

  contactNameFor(contacts: unknown, waId: string): string | undefined {
    if (!Array.isArray(contacts)) return undefined;
    const contact = contacts
      .map((item) => asRecord(item))
      .find((item) => asNonEmptyString(item?.wa_id) === waId);
    return asNonEmptyString(asRecord(contact?.profile)?.name);
  }

  safeInboundMediaContent(media: WhatsappIncomingMediaMessage): string {
    if (media.mediaType === 'image') return '[Imagen recibida]';
    const fileName = safeFileName(media.fileName);
    return fileName
      ? `[Documento recibido: ${fileName}]`
      : '[Documento recibido]';
  }

  isSupportedMediaType(
    value: unknown,
  ): value is WhatsappIncomingMediaMessageType {
    return isWhatsappPaymentProofSupportedMediaType(value);
  }

  private configuredTenantCode(): string {
    return (
      this.config.get<string>('IPDE_TENANT_CODE')?.trim() ?? IPDE_TENANT_CODE
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeFileName(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    !normalized ||
    normalized.includes('..') ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    return null;
  }
  return normalized.slice(0, 120);
}
