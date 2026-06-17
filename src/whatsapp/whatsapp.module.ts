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

@Module({
  imports: [
    TenantsModule,
    LeadsModule,
    ConversationsModule,
    UsageModule,
    RulesModule,
    AiModule,
    KnowledgeModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
