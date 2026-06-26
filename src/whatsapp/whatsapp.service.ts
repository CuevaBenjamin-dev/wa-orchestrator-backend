import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageRole } from '@prisma/client';
import { TenantsService } from '../tenants/tenants.service';
import { LeadsService } from '../leads/leads.service';
import { ConversationsService } from '../conversations/conversations.service';
import { UsageService } from '../usage/usage.service';
import { RulesService } from '../rules/rules.service';
import { AiService } from '../ai/ai.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { IpdeWhatsappOrchestratorService } from '../ipde-sales/whatsapp/ipde-whatsapp-orchestrator.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly tenantsService: TenantsService,
    private readonly leadsService: LeadsService,
    private readonly conversationsService: ConversationsService,
    private readonly usageService: UsageService,
    private readonly rulesService: RulesService,
    private readonly aiService: AiService,
    private readonly knowledgeService: KnowledgeService,
    private readonly ipdeWhatsapp: IpdeWhatsappOrchestratorService,
  ) {}

  /**
   * Envía un mensaje de texto usando WhatsApp Cloud API.
   *
   * En desarrollo podemos desactivar el envío real con:
   * WHATSAPP_SEND_ENABLED=false
   */
  private async sendTextMessage(params: {
    phoneNumberId: string;
    to: string;
    text: string;
  }) {
    const { phoneNumberId, to, text } = params;

    const sendEnabled =
      this.configService.get<string>('WHATSAPP_SEND_ENABLED') === 'true';

    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    const apiVersion =
      this.configService.get<string>('WHATSAPP_API_VERSION') || 'v21.0';

    /**
     * Modo seguro:
     * Si el envío está desactivado, no llamamos a Meta.
     * Esto evita mensajes accidentales y errores con tokens falsos.
     */
    if (!sendEnabled) {
      return {
        attempted: false,
        success: false,
        simulated: true,
        reason: 'WHATSAPP_SEND_DISABLED',
      };
    }

    /**
     * Si no hay token real, tampoco intentamos enviar.
     */
    if (!accessToken || accessToken === 'token_de_meta') {
      return {
        attempted: false,
        success: false,
        simulated: true,
        reason: 'WHATSAPP_ACCESS_TOKEN_NOT_CONFIGURED',
      };
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error('Error enviando mensaje por WhatsApp', data);

        return {
          attempted: true,
          success: false,
          simulated: false,
          error: data,
        };
      }

      return {
        attempted: true,
        success: true,
        simulated: false,
        providerMessageId: data?.messages?.[0]?.id,
        data,
      };
    } catch (error) {
      this.logger.error('Error inesperado enviando WhatsApp', error);

      return {
        attempted: true,
        success: false,
        simulated: false,
        error,
      };
    }
  }

  /**
   * Procesa el payload que llega desde WhatsApp Cloud API.
   *
   * En Meta, un webhook puede traer varios entries, changes y messages.
   * Por eso recorremos la estructura con seguridad.
   */
  async handleIncomingWebhook(body: any) {
    const results: any[] = [];

    const entries = body?.entry ?? [];

    for (const entry of entries) {
      const changes = entry?.changes ?? [];

      for (const change of changes) {
        const value = change?.value;

        if (!value) {
          continue;
        }

        const phoneNumberId = value?.metadata?.phone_number_id;
        const messages = value?.messages ?? [];
        const contacts = value?.contacts ?? [];

        if (!phoneNumberId) {
          this.logger.warn('Webhook recibido sin phone_number_id');
          continue;
        }

        /**
         * Buscamos a qué negocio pertenece este mensaje.
         * phoneNumberId viene desde Meta/WhatsApp.
         */
        const tenant =
          await this.tenantsService.findByWhatsappPhoneId(phoneNumberId);

        if (!tenant) {
          this.logger.warn(
            `No existe tenant para whatsappPhoneId=${phoneNumberId}`,
          );

          results.push({
            status: 'tenant_not_found',
            phoneNumberId,
          });

          continue;
        }

        for (const message of messages) {
          const tipoMensaje = message?.type;
          const telefonoDelUsuario = message?.from;
          const idExternoWhatsapp = message?.id;

          /**
           * Evitamos procesar dos veces el mismo mensaje de WhatsApp.
           * Meta puede reintentar webhooks si hubo demora, error o falta de 200.
           */
          if (idExternoWhatsapp) {
            const existingMessage =
              await this.conversationsService.findByExternalId(
                idExternoWhatsapp,
              );

            if (existingMessage) {
              results.push({
                status: 'duplicated_message_ignored',
                externalId: idExternoWhatsapp,
              });

              continue;
            }
          }

          if (
            this.ipdeWhatsapp.canHandleTenant({
              tenant,
              phoneNumberId,
            })
          ) {
            results.push(
              await this.ipdeWhatsapp.handleIncomingMessage({
                tenant,
                phoneNumberId,
                message,
                contacts,
              }),
            );

            continue;
          }

          /**
           * En este MVP solo procesamos texto.
           * Luego podremos agregar audios, imágenes o documentos.
           */
          if (tipoMensaje !== 'text') {
            results.push({
              status: 'ignored_non_text_message',
              tenantId: tenant.id,
              messageType: tipoMensaje,
            });

            continue;
          }

          const mensajeDelUsuario = message?.text?.body;

          if (!telefonoDelUsuario || !mensajeDelUsuario) {
            results.push({
              status: 'ignored_empty_message',
              tenantId: tenant.id,
            });

            continue;
          }

          const contact = contacts.find(
            (c: any) => c?.wa_id === telefonoDelUsuario,
          );

          const nombreDelUsuario = contact?.profile?.name;

          /**
           * 1. Creamos o encontramos el lead.
           */
          const lead = await this.leadsService.findOrCreateLead({
            tenantId: tenant.id,
            phone: telefonoDelUsuario,
            name: nombreDelUsuario,
          });

          /**
           * 2. Creamos o encontramos la conversación.
           */
          const conversation =
            await this.conversationsService.findOrCreateConversation({
              tenantId: tenant.id,
              leadId: lead.id,
            });

          /**
           * 3. Guardamos el mensaje entrante.
           */
          await this.conversationsService.addMessage({
            conversationId: conversation.id,
            role: MessageRole.USER,
            content: mensajeDelUsuario,
            externalId: idExternoWhatsapp,
          });

          /**
           * 4. Registramos consumo: mensaje entrante.
           */
          await this.usageService.incrementInboundMessage(tenant.id);

          /**
           * 5. Evaluamos reglas antes de gastar IA.
           */
          const ruleResult = await this.rulesService.evaluateMessage({
            tenantId: tenant.id,
            message: mensajeDelUsuario,
            tenantName: tenant.name,
            businessType: tenant.businessType,
          });

          let respuestaDelAgente = '';
          let responseSource: 'RULE' | 'RAG' | 'AI' = 'RULE';
          let tokensInput = 0;
          let tokensOutput = 0;

          if (ruleResult.answeredByRule && ruleResult.reply) {
            respuestaDelAgente = ruleResult.reply;
            responseSource = 'RULE';
          } else {
            /**
             * 6. Si no hay respuesta por keyword,
             * clasificamos la intención del usuario con IA.
             *
             * Este clasificador NO responde al cliente.
             * Solo decide la ruta más conveniente.
             */
            const intentClassification =
              await this.aiService.classifyUserIntent({
                tenantName: tenant.name,
                businessType: tenant.businessType,
                businessInfo: tenant.agentConfig?.businessInfo,
                services: tenant.agentConfig?.services,
                userMessage: mensajeDelUsuario,
              });

            this.logger.log(
              `Intent detectado: ${intentClassification.intent} | confidence=${intentClassification.confidence}`,
            );

            /**
             * 7. Si el clasificador recomienda respuesta predefinida,
             * buscamos una respuesta por intent en la base de datos.
             */
            if (intentClassification.shouldUsePredefinedResponse) {
              const intentResponse =
                await this.rulesService.findPredefinedResponseByIntent({
                  tenantId: tenant.id,
                  intent: intentClassification.intent,
                });

              if (intentResponse) {
                respuestaDelAgente = intentResponse.response;
                responseSource = 'RULE';
              }
            }

            /**
             * 8. Si la intención necesita información del negocio,
             * usamos RAG liviano con KnowledgeItem.
             */
            if (!respuestaDelAgente && intentClassification.shouldUseRag) {
              const knowledgeItems =
                await this.knowledgeService.searchRelevantKnowledgeItems({
                  tenantId: tenant.id,
                  userMessage: mensajeDelUsuario,
                  intent: intentClassification.intent,
                  limit: 5,
                });

              const knowledgeContext =
                this.knowledgeService.buildKnowledgeContext(knowledgeItems);

              this.logger.log(
                `RAG liviano: ${knowledgeItems.length} KnowledgeItems recuperados.`,
              );

              if (knowledgeContext) {
                const recentMessages =
                  await this.conversationsService.getRecentMessages(
                    conversation.id,
                    6,
                  );

                const aiResponse = await this.aiService.generateAgentReply({
                  tenantName: tenant.name,
                  businessType: tenant.businessType,
                  tone: tenant.agentConfig?.tone,
                  objective: tenant.agentConfig?.objective,
                  businessInfo: tenant.agentConfig?.businessInfo,
                  services: tenant.agentConfig?.services,
                  fixedRules: tenant.agentConfig?.fixedRules,
                  humanHandoffRules: tenant.agentConfig?.humanHandoffRules,
                  knowledgeContext,
                  userMessage: mensajeDelUsuario,
                  recentMessages: recentMessages.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                  })),
                });

                respuestaDelAgente = aiResponse.text;
                tokensInput = aiResponse.tokensInput;
                tokensOutput = aiResponse.tokensOutput;
                responseSource = 'RAG';

                await this.usageService.incrementAiUsage({
                  tenantId: tenant.id,
                  tokensInput,
                  tokensOutput,
                });
              }
            }

            /**
             * 8. Si todavía no tenemos respuesta,
             * usamos IA generativa como fallback.
             */
            if (!respuestaDelAgente) {
              const recentMessages =
                await this.conversationsService.getRecentMessages(
                  conversation.id,
                  6,
                );

              const aiResponse = await this.aiService.generateAgentReply({
                tenantName: tenant.name,
                businessType: tenant.businessType,
                tone: tenant.agentConfig?.tone,
                objective: tenant.agentConfig?.objective,
                businessInfo: tenant.agentConfig?.businessInfo,
                services: tenant.agentConfig?.services,
                fixedRules: tenant.agentConfig?.fixedRules,
                humanHandoffRules: tenant.agentConfig?.humanHandoffRules,
                knowledgeContext: null,
                userMessage: mensajeDelUsuario,
                recentMessages: recentMessages.map((msg) => ({
                  role: msg.role,
                  content: msg.content,
                })),
              });

              respuestaDelAgente = aiResponse.text;
              tokensInput = aiResponse.tokensInput;
              tokensOutput = aiResponse.tokensOutput;
              responseSource = 'AI';

              await this.usageService.incrementAiUsage({
                tenantId: tenant.id,
                tokensInput,
                tokensOutput,
              });
            }
          }

          /**
           * 8. Intentamos enviar la respuesta por WhatsApp.
           *
           * Si WHATSAPP_SEND_ENABLED=false, esto NO enviará nada real.
           * Solo devolverá un resultado simulado.
           */
          const whatsappSendResult = await this.sendTextMessage({
            phoneNumberId,
            to: telefonoDelUsuario,
            text: respuestaDelAgente,
          });

          /**
           * 9. Guardamos la respuesta del agente en la conversación.
           *
           * Si Meta devuelve un ID del mensaje enviado, lo guardamos como externalId.
           */
          await this.conversationsService.addMessage({
            conversationId: conversation.id,
            role: MessageRole.ASSISTANT,
            content: respuestaDelAgente,
            externalId: whatsappSendResult.providerMessageId,
            tokensInput,
            tokensOutput,
          });

          results.push({
            status: 'message_processed',
            tenantId: tenant.id,
            tenantName: tenant.name,
            leadId: lead.id,
            conversationId: conversation.id,
            from: telefonoDelUsuario,
            userMessage: mensajeDelUsuario,
            agentReply: respuestaDelAgente,
            responseSource,
            ruleReason: ruleResult.reason,
            requiresHuman: ruleResult.requiresHuman,
            tokensInput,
            tokensOutput,
            whatsappSendResult,
          });
        }
      }
    }

    return {
      processed: results.length,
      results,
    };
  }
}
