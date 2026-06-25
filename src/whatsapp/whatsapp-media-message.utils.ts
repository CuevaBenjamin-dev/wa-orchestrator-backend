import {
  WhatsappIncomingMediaMessage,
  WhatsappIncomingMediaMessageType,
} from './whatsapp-media-message.types';

export function extractWhatsappIncomingMediaMessage(
  message: unknown,
): WhatsappIncomingMediaMessage | null {
  const payload = asRecord(message);
  if (!payload) {
    return null;
  }

  const mediaType = payload?.type;
  if (mediaType !== 'image' && mediaType !== 'document') {
    return null;
  }

  const media = asRecord(payload[mediaType]);
  const providerMediaId = asNonEmptyString(media?.id);
  const providerMessageId = asNonEmptyString(payload.id);
  if (!providerMediaId || !providerMessageId) {
    return null;
  }

  return {
    provider: 'WHATSAPP',
    providerMessageId,
    providerMediaId,
    mediaType,
    mimeType: asNonEmptyString(media?.mime_type),
    fileName:
      mediaType === 'document' ? asNonEmptyString(media?.filename) : undefined,
    caption: asNonEmptyString(media?.caption),
    sha256: asNonEmptyString(media?.sha256),
    from: asNonEmptyString(payload.from),
    timestamp: asNonEmptyString(payload.timestamp),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isWhatsappPaymentProofSupportedMediaType(
  mediaType: unknown,
): mediaType is WhatsappIncomingMediaMessageType {
  return mediaType === 'image' || mediaType === 'document';
}
