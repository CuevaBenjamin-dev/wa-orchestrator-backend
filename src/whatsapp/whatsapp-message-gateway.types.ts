export interface WhatsappSendResult {
  attempted: boolean;
  success: boolean;
  simulated: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface WhatsappMediaUploadResult {
  attempted: boolean;
  success: boolean;
  simulated: boolean;
  providerMediaId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface WhatsappTextMessageParams {
  phoneNumberId: string;
  to: string;
  text: string;
}

export interface WhatsappImageMessageParams {
  phoneNumberId: string;
  to: string;
  mediaId?: string;
  link?: string;
  caption?: string;
}

export interface WhatsappDocumentMessageParams {
  phoneNumberId: string;
  to: string;
  mediaId?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

export interface WhatsappMediaUploadParams {
  phoneNumberId: string;
  filePath: string;
  mimeType: string;
}
