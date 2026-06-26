import { ConfigService } from '@nestjs/config';
import { IpdeWhatsappMessageMapperService } from './ipde-whatsapp-message-mapper.service';

describe('IpdeWhatsappMessageMapperService', () => {
  it('routes IPDE only by stable configured phone id, not visible tenant name', () => {
    const mapper = createMapper();

    expect(
      mapper.canHandleTenant({
        phoneNumberId: 'ipde-phone-id',
        tenant: tenant({ name: 'Nombre visible editable' }),
      }),
    ).toBe(true);
    expect(
      mapper.canHandleTenant({
        phoneNumberId: 'another-phone-id',
        tenant: tenant({ whatsappPhoneId: 'another-phone-id' }),
      }),
    ).toBe(false);
  });

  it('does not route IPDE when the explicit phone id is missing', () => {
    const mapper = createMapper({});

    expect(
      mapper.canHandleTenant({
        phoneNumberId: 'ipde-phone-id',
        tenant: tenant(),
      }),
    ).toBe(false);
  });

  it('maps text messages and contact names safely', () => {
    const mapper = createMapper();

    expect(
      mapper.mapTextMessage({
        id: 'wamid.text-1',
        from: '51999999999',
        type: 'text',
        text: { body: ' Quiero precio ' },
      }),
    ).toEqual({
      providerMessageId: 'wamid.text-1',
      from: '51999999999',
      text: 'Quiero precio',
    });
    expect(
      mapper.contactNameFor(
        [{ wa_id: '51999999999', profile: { name: 'Benja' } }],
        '51999999999',
      ),
    ).toBe('Benja');
  });

  it('maps supported media and produces safe inbound summaries', () => {
    const mapper = createMapper();
    const image = mapper.mapMediaMessage({
      id: 'wamid.image-1',
      from: '51999999999',
      type: 'image',
      image: {
        id: 'media-image-1',
        mime_type: 'image/jpeg',
        caption: 'Voucher Yape',
      },
    });
    const document = mapper.mapMediaMessage({
      id: 'wamid.doc-1',
      from: '51999999999',
      type: 'document',
      document: {
        id: 'media-doc-1',
        mime_type: 'application/pdf',
        filename: ' comprobante.pdf ',
      },
    });

    expect(image).toMatchObject({
      providerMessageId: 'wamid.image-1',
      providerMediaId: 'media-image-1',
      mediaType: 'image',
      caption: 'Voucher Yape',
    });
    expect(image && mapper.safeInboundMediaContent(image)).toBe(
      '[Imagen recibida]',
    );
    expect(document && mapper.safeInboundMediaContent(document)).toBe(
      '[Documento recibido: comprobante.pdf]',
    );
  });

  it('rejects invalid or unsupported media payloads', () => {
    const mapper = createMapper();

    expect(
      mapper.mapMediaMessage({
        id: 'wamid.audio-1',
        from: '51999999999',
        type: 'audio',
        audio: { id: 'media-audio-1' },
      }),
    ).toBeNull();
    expect(
      mapper.mapMediaMessage({
        id: 'wamid.image-2',
        type: 'image',
        image: {},
      }),
    ).toBeNull();
  });
});

function createMapper(
  overrides: Record<string, string | undefined> = {
    IPDE_WHATSAPP_PHONE_ID: 'ipde-phone-id',
  },
): IpdeWhatsappMessageMapperService {
  return new IpdeWhatsappMessageMapperService(new ConfigService(overrides));
}

function tenant(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'tenant-1',
    name: 'IPDE',
    businessType: 'education',
    whatsappPhoneId: 'ipde-phone-id',
    status: 'ACTIVE',
    ...overrides,
  };
}
