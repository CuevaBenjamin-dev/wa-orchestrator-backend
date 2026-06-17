import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantsService } from './tenants.service';

/**
 * Este controller es temporal para probar la base de datos.
 * Más adelante protegeremos estos endpoints con autenticación.
 */
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Post('demo')
  createDemoTenant() {
    return this.tenantsService.createDemoTenant();
  }

  /**
   * Endpoint temporal de desarrollo.
   *
   * Sirve para actualizar el phone_number_id real de WhatsApp
   * cuando lo obtengamos desde Meta Developers.
   */
  @Patch(':id/whatsapp-phone-id')
  updateWhatsappPhoneId(
    @Param('id') id: string,
    @Body('whatsappPhoneId') whatsappPhoneId: string,
  ) {
    return this.tenantsService.updateWhatsappPhoneId({
      tenantId: id,
      whatsappPhoneId,
    });
  }

  @Post('demo/colegio-abogados-callao')
  createColegioAbogadosCallaoTenant() {
    return this.tenantsService.createColegioAbogadosCallaoTenant();
  }

  @Post(':id/seed-intent-responses')
  seedIntentResponses(@Param('id') id: string) {
    return this.tenantsService.seedIntentResponsesForTenant(id);
  }

  @Post(':id/seed-knowledge-items')
  seedKnowledgeItems(@Param('id') id: string) {
    return this.tenantsService.seedKnowledgeItemsForTenant(id);
  }

  @Patch(':id/agent-config')
  updateAgentConfig(@Param('id') id: string, @Body() body: any) {
    return this.tenantsService.updateAgentConfigForTenant({
      tenantId: id,
      tone: body.tone,
      objective: body.objective,
      businessInfo: body.businessInfo,
      services: body.services,
      fixedRules: body.fixedRules,
      humanHandoffRules: body.humanHandoffRules,
    });
  }
}
