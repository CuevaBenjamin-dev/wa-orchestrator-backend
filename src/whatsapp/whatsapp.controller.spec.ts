import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappSignatureService } from './security/whatsapp-signature.service';

describe('WhatsappController', () => {
  it('keeps Meta webhook verification working for the expected token', () => {
    const { controller, response } = createController();

    controller.verifyWebhook(
      request({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-token',
        'hub.challenge': 'challenge-123',
      }),
      response as unknown as Response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith('challenge-123');
  });

  it('rejects webhook verification with an invalid token', () => {
    const { controller, response } = createController();

    controller.verifyWebhook(
      request({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      }),
      response as unknown as Response,
    );

    expect(response.sendStatus).toHaveBeenCalledWith(403);
  });

  it('rejects POST webhook and does not process body when signature fails', async () => {
    const { controller, response, handleIncomingWebhook, validateSignature } =
      createController({ signatureOk: false });

    await controller.receiveMessage(
      postRequest(),
      { entry: [] },
      response as unknown as Response,
    );

    expect(validateSignature).toHaveBeenCalledWith({
      signatureHeader: 'sha256=invalid',
      rawBody: Buffer.from('{}'),
    });
    expect(response.sendStatus).toHaveBeenCalledWith(403);
    expect(handleIncomingWebhook).not.toHaveBeenCalled();
  });

  it('processes POST webhook when signature validation passes', async () => {
    const { controller, response, handleIncomingWebhook } = createController();

    await controller.receiveMessage(
      postRequest(),
      { entry: [] },
      response as unknown as Response,
    );

    expect(handleIncomingWebhook).toHaveBeenCalledWith({
      entry: [],
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith({
      received: true,
      result: { processed: 0, results: [] },
    });
  });
});

function createController(options: { signatureOk?: boolean } = {}) {
  const response = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    sendStatus: jest.fn(),
  };
  const handleIncomingWebhook = jest
    .fn()
    .mockResolvedValue({ processed: 0, results: [] });
  const whatsappService = {
    handleIncomingWebhook,
  } as unknown as WhatsappService;
  const validateSignature = jest
    .fn()
    .mockReturnValue(
      options.signatureOk === false
        ? { ok: false, errorCode: 'SIGNATURE_MISMATCH' }
        : { ok: true, status: 'VALID' },
    );
  const signatureService = {
    validate: validateSignature,
  } as unknown as WhatsappSignatureService;
  const controller = new WhatsappController(
    new ConfigService({ WHATSAPP_VERIFY_TOKEN: 'verify-token' }),
    whatsappService,
    signatureService,
  );

  return { controller, response, handleIncomingWebhook, validateSignature };
}

function request(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

function postRequest(): Request & { rawBody: Buffer } {
  return {
    headers: { 'x-hub-signature-256': 'sha256=invalid' },
    rawBody: Buffer.from('{}'),
  } as unknown as Request & { rawBody: Buffer };
}
