import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AiModule } from './ai/ai.module';
import { LeadsModule } from './leads/leads.module';
import { ConversationsModule } from './conversations/conversations.module';
import { UsageModule } from './usage/usage.module';
import { RulesModule } from './rules/rules.module';
import { CatalogModule } from './catalog/catalog.module';
import { IpdeSalesModule } from './ipde-sales/ipde-sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    PrismaModule,
    TenantsModule,
    WhatsappModule,
    AiModule,
    LeadsModule,
    ConversationsModule,
    UsageModule,
    RulesModule,
    CatalogModule,
    IpdeSalesModule,
  ],
})
export class AppModule {}
