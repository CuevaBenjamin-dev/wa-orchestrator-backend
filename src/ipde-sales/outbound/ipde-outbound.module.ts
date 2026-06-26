import { Module } from '@nestjs/common';
import { WhatsappGatewayModule } from '../../whatsapp/whatsapp-gateway.module';
import { IpdeCommercialConfigModule } from '../commercial-config/ipde-commercial-config.module';
import { IpdeMediaModule } from '../media/ipde-media.module';
import { IpdeOutboundActionExecutorService } from './ipde-outbound-action-executor.service';

@Module({
  imports: [WhatsappGatewayModule, IpdeCommercialConfigModule, IpdeMediaModule],
  providers: [IpdeOutboundActionExecutorService],
  exports: [IpdeOutboundActionExecutorService],
})
export class IpdeOutboundModule {}
