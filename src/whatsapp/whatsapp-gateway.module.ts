import { Module } from '@nestjs/common';
import { WhatsappMessageGatewayService } from './whatsapp-message-gateway.service';

@Module({
  providers: [WhatsappMessageGatewayService],
  exports: [WhatsappMessageGatewayService],
})
export class WhatsappGatewayModule {}
