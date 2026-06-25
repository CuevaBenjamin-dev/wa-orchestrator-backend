import { extractWhatsappIncomingMediaMessage } from './whatsapp-media-message.utils';

describe('extractWhatsappIncomingMediaMessage', () => {
  it('extracts image media metadata without downloading the file', () => {
    expect(
      extractWhatsappIncomingMediaMessage({
        id: 'wamid.image',
        from: '51999999999',
        timestamp: '1780000000',
        type: 'image',
        image: {
          id: 'media-image-1',
          mime_type: 'image/jpeg',
          caption: 'voucher',
          sha256: 'sha-image',
        },
      }),
    ).toEqual({
      provider: 'WHATSAPP',
      providerMessageId: 'wamid.image',
      providerMediaId: 'media-image-1',
      mediaType: 'image',
      mimeType: 'image/jpeg',
      fileName: undefined,
      caption: 'voucher',
      sha256: 'sha-image',
      from: '51999999999',
      timestamp: '1780000000',
    });
  });

  it('extracts document media metadata', () => {
    expect(
      extractWhatsappIncomingMediaMessage({
        id: 'wamid.document',
        type: 'document',
        document: {
          id: 'media-document-1',
          mime_type: 'application/pdf',
          filename: 'comprobante.pdf',
          caption: 'comprobante',
        },
      }),
    ).toMatchObject({
      providerMessageId: 'wamid.document',
      providerMediaId: 'media-document-1',
      mediaType: 'document',
      mimeType: 'application/pdf',
      fileName: 'comprobante.pdf',
      caption: 'comprobante',
    });
  });

  it('returns null for non-media messages', () => {
    expect(
      extractWhatsappIncomingMediaMessage({
        id: 'wamid.text',
        type: 'text',
        text: { body: 'hola' },
      }),
    ).toBeNull();
  });
});
