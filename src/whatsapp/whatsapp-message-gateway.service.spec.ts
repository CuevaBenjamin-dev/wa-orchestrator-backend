import { ConfigService } from '@nestjs/config';
import { WhatsappMessageGatewayService } from './whatsapp-message-gateway.service';

describe('WhatsappMessageGatewayService', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  afterEach(() => {
    fetchMock?.mockRestore();
    jest.useRealTimers();
  });

  it('simulates text when WHATSAPP_SEND_ENABLED=false', async () => {
    fetchMock = jest.spyOn(global, 'fetch');
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'false' });

    await expect(
      service.sendText({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        text: 'Hola',
      }),
    ).resolves.toMatchObject({
      attempted: false,
      success: true,
      simulated: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('simulates image and document sends without calling Meta', async () => {
    fetchMock = jest.spyOn(global, 'fetch');
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'false' });

    await expect(
      service.sendImage({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        mediaId: 'media-id',
      }),
    ).resolves.toMatchObject({ success: true, simulated: true });
    await expect(
      service.sendDocument({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        link: 'https://example.com/model.pdf',
      }),
    ).resolves.toMatchObject({ success: true, simulated: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds a real text payload with mock fetch', async () => {
    fetchMock = mockMetaResponse(200, { messages: [{ id: 'wamid.text' }] });
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'true' });

    const result = await service.sendText({
      phoneNumberId: 'phone-id',
      to: '51999999999',
      text: 'Hola',
    });

    expect(result).toMatchObject({
      attempted: true,
      success: true,
      providerMessageId: 'wamid.text',
    });
    expect(sentPayload()).toEqual({
      messaging_product: 'whatsapp',
      to: '51999999999',
      type: 'text',
      text: { preview_url: false, body: 'Hola' },
    });
  });

  it('builds image payloads by ID and by link', async () => {
    fetchMock = mockMetaResponse(200, { messages: [{ id: 'wamid.image' }] });
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'true' });

    await service.sendImage({
      phoneNumberId: 'phone-id',
      to: '51999999999',
      mediaId: 'media-id',
      caption: 'Promo',
    });
    expect(sentPayload()).toMatchObject({
      type: 'image',
      image: { id: 'media-id', caption: 'Promo' },
    });

    await service.sendImage({
      phoneNumberId: 'phone-id',
      to: '51999999999',
      link: 'https://example.com/promo.png',
    });
    expect(sentPayload(1)).toMatchObject({
      type: 'image',
      image: { link: 'https://example.com/promo.png' },
    });
  });

  it('builds document payloads by ID and by link', async () => {
    fetchMock = mockMetaResponse(200, { messages: [{ id: 'wamid.document' }] });
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'true' });

    await service.sendDocument({
      phoneNumberId: 'phone-id',
      to: '51999999999',
      mediaId: 'document-id',
      filename: 'modelo.pdf',
    });
    expect(sentPayload()).toMatchObject({
      type: 'document',
      document: { id: 'document-id', filename: 'modelo.pdf' },
    });

    await service.sendDocument({
      phoneNumberId: 'phone-id',
      to: '51999999999',
      link: 'https://example.com/modelo.pdf',
      caption: 'Modelo',
    });
    expect(sentPayload(1)).toMatchObject({
      type: 'document',
      document: { link: 'https://example.com/modelo.pdf', caption: 'Modelo' },
    });
  });

  it('does not mix media ID and link', async () => {
    fetchMock = jest.spyOn(global, 'fetch');
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'true' });

    await expect(
      service.sendImage({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        mediaId: 'media-id',
        link: 'https://example.com/promo.png',
      }),
    ).resolves.toMatchObject({
      attempted: false,
      success: false,
      errorCode: 'INVALID_MEDIA_SOURCE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'AUTHORIZATION_ERROR'],
    [403, 'AUTHORIZATION_ERROR'],
    [429, 'RATE_LIMIT'],
    [500, 'META_SERVER_ERROR'],
  ])('maps HTTP %s to %s', async (status, code) => {
    fetchMock = mockMetaResponse(status, {
      error: { message: 'Meta says no' },
    });
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'true' });

    await expect(
      service.sendText({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        text: 'Hola',
      }),
    ).resolves.toMatchObject({
      attempted: true,
      success: false,
      errorCode: code,
      errorMessage: 'Meta says no',
    });
  });

  it('handles invalid JSON and missing provider IDs', async () => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const service = gateway({ WHATSAPP_SEND_ENABLED: 'true' });

    await expect(
      service.sendText({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        text: 'Hola',
      }),
    ).resolves.toMatchObject({ errorCode: 'JSON_INVALID' });
    await expect(
      service.sendText({
        phoneNumberId: 'phone-id',
        to: '51999999999',
        text: 'Hola',
      }),
    ).resolves.toMatchObject({ errorCode: 'PROVIDER_MESSAGE_ID_MISSING' });
  });

  it('handles timeout without a real network call completing', async () => {
    jest.useFakeTimers();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const service = gateway({
      WHATSAPP_SEND_ENABLED: 'true',
      WHATSAPP_REQUEST_TIMEOUT_MS: '1000',
    });

    const promise = service.sendText({
      phoneNumberId: 'phone-id',
      to: '51999999999',
      text: 'Hola',
    });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toMatchObject({ errorCode: 'TIMEOUT' });
  });

  function gateway(env: Record<string, string>): WhatsappMessageGatewayService {
    return new WhatsappMessageGatewayService(
      new ConfigService({
        WHATSAPP_ACCESS_TOKEN: 'test-token',
        WHATSAPP_API_VERSION: 'v21.0',
        ...env,
      }),
    );
  }

  function mockMetaResponse(status: number, body: unknown) {
    return jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  function sentPayload(callIndex = 0): unknown {
    const init = fetchMock.mock.calls[callIndex][1];
    const body = init?.body;
    if (typeof body !== 'string') {
      throw new Error('Expected JSON string body');
    }
    return JSON.parse(body) as unknown;
  }
});
