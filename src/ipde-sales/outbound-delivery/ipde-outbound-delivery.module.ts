import { Module } from '@nestjs/common';
import { WhatsappGatewayModule } from '../../whatsapp/whatsapp-gateway.module';
import { IpdeCommercialConfigModule } from '../commercial-config/ipde-commercial-config.module';
import { IpdeMediaModule } from '../media/ipde-media.module';
import { IpdeOutboundDeliveryRepository } from './ipde-outbound-delivery.repository';
import { IpdeOutboundDeliveryService } from './ipde-outbound-delivery.service';

@Module({
  imports: [WhatsappGatewayModule, IpdeCommercialConfigModule, IpdeMediaModule],
  providers: [IpdeOutboundDeliveryRepository, IpdeOutboundDeliveryService],
  exports: [IpdeOutboundDeliveryService],
})
export class IpdeOutboundDeliveryModule {}
