import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';

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
});

function createController() {
  const response = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    sendStatus: jest.fn(),
  };
  const whatsappService = {
    handleIncomingWebhook: jest.fn(),
  } as unknown as WhatsappService;
  const controller = new WhatsappController(
    new ConfigService({ WHATSAPP_VERIFY_TOKEN: 'verify-token' }),
    whatsappService,
  );

  return { controller, response };
}

function request(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}
