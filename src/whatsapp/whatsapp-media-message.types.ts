export type WhatsappIncomingMediaMessageType = 'image' | 'document';

export interface WhatsappIncomingMediaMessage {
  provider: 'WHATSAPP';
  providerMessageId: string;
  providerMediaId: string;
  mediaType: WhatsappIncomingMediaMessageType;
  mimeType?: string;
  fileName?: string;
  caption?: string;
  sha256?: string;
  from?: string;
  timestamp?: string;
}
