import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { TenantsModule } from '../tenants/tenants.module';
import { LeadsModule } from '../leads/leads.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsageModule } from '../usage/usage.module';
import { RulesModule } from '../rules/rules.module';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { IpdeWhatsappModule } from '../ipde-sales/whatsapp/ipde-whatsapp.module';
import { WhatsappGatewayModule } from './whatsapp-gateway.module';

@Module({
  imports: [
    TenantsModule,
    LeadsModule,
    ConversationsModule,
    UsageModule,
    RulesModule,
    AiModule,
    KnowledgeModule,
    WhatsappGatewayModule,
    IpdeWhatsappModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappGatewayModule],
})
export class WhatsappModule {}
