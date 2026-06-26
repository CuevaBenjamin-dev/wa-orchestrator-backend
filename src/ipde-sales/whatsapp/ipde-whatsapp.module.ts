import { Module } from '@nestjs/common';
import { ConversationsModule } from '../../conversations/conversations.module';
import { LeadsModule } from '../../leads/leads.module';
import { UsageModule } from '../../usage/usage.module';
import { IpdeSalesModule } from '../ipde-sales.module';
import { IpdeWhatsappMessageMapperService } from './ipde-whatsapp-message-mapper.service';
import { IpdeWhatsappOrchestratorService } from './ipde-whatsapp-orchestrator.service';
import { IpdeWhatsappOutboundPersistenceService } from './ipde-whatsapp-outbound-persistence.service';

@Module({
  imports: [LeadsModule, ConversationsModule, UsageModule, IpdeSalesModule],
  providers: [
    IpdeWhatsappMessageMapperService,
    IpdeWhatsappOutboundPersistenceService,
    IpdeWhatsappOrchestratorService,
  ],
  exports: [IpdeWhatsappOrchestratorService],
})
export class IpdeWhatsappModule {}
