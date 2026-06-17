import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { WhatsappService } from './whatsapp.service';

@Controller('webhooks/whatsapp')
export class WhatsappController {
  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Este endpoint es para que Facebook/Meta pueda verificar que el webhook es nuestro.
   * Cuando configuramos el webhook en la plataforma de Meta, nos piden una URL y un token de verificación.
   * Meta hace una solicitud GET a esa URL con ciertos parámetros, y espera que respondamos con un código de desafío si el token es correcto.
   * Si el token no coincide, debemos responder con un error 403 para indicar que la verificación ha fallado.
   * Es importante que este endpoint esté disponible públicamente para que Meta pueda acceder a él durante el proceso de verificación.
   * Una vez que Meta haya verificado el webhook, comenzará a enviar eventos a este mismo endpoint mediante solicitudes POST, que es lo que manejamos en el siguiente método.
   * En resumen, este método es esencial para establecer la conexión inicial entre nuestro servidor y la plataforma de Meta, permitiendo que recibamos eventos de WhatsApp en el futuro.
   */
  @Get()
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const query = req.query as Record<string, any>;

    const mode = String(query['hub.mode'] ?? '');
    const verifyToken = String(query['hub.verify_token'] ?? '').trim();
    const challenge = String(query['hub.challenge'] ?? '');

    const expectedToken =
      this.configService.get<string>('WHATSAPP_VERIFY_TOKEN')?.trim() ?? '';

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  /**
   * Aquí llegan los eventos reales de WhatsApp:
   * - mensajes entrantes
   * - estados de entrega
   * - cambios relacionados con la cuenta
   */
  @Post()
  async receiveMessage(@Body() body: any) {
    const result = await this.whatsappService.handleIncomingWebhook(body);

    return {
      received: true,
      result,
    };
  }
}
