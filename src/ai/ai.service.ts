import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

type GenerateAgentReplyParams = {
  tenantName: string;
  businessType: string;
  tone?: string | null;
  objective?: string | null;
  businessInfo?: string | null;
  services?: string | null;
  fixedRules?: string | null;
  humanHandoffRules?: string | null;
  knowledgeContext?: string | null;
  userMessage: string;
  recentMessages: Array<{
    role: string;
    content: string;
  }>;
};

type GenerateAgentReplyResult = {
  text: string;
  tokensInput: number;
  tokensOutput: number;
};

const IntentClassificationSchema = z.object({
  intent: z.enum([
    'SALUDO',
    'PRECIO',
    'INSCRIPCION',
    'CERTIFICADO',
    'MODALIDAD',
    'HORARIO',
    'INFORMACION_PROGRAMA',
    'REQUISITOS',
    'PAGO',
    'HUMANO',
    'RECLAMO',
    'OTRO',
  ]),
  confidence: z.number(),
  shouldUsePredefinedResponse: z.boolean(),
  shouldUseRag: z.boolean(),
  requiresHuman: z.boolean(),
  reason: z.string(),
});

export type IntentClassificationResult = z.infer<
  typeof IntentClassificationSchema
>;

/**
 * AiService encapsula la comunicación con OpenAI.
 *
 * Importante:
 * El resto del sistema NO debe llamar directamente a OpenAI.
 * Siempre debe pasar por este servicio.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    /**
     * Si no hay API key, dejamos client en null.
     * Esto permite seguir probando el backend sin gastar tokens.
     */
    this.client = apiKey
      ? new OpenAI({
          apiKey,
        })
      : null;
  }

  /**
   * Clasificación local de respaldo.
   *
   * Se usa cuando:
   * - No hay OPENAI_API_KEY
   * - OpenAI devuelve output_parsed = null
   * - OpenAI falla por timeout, token, modelo, red, etc.
   *
   * Esto evita que el flujo de WhatsApp se rompa.
   */
  private classifyUserIntentLocally(
    userMessage: string,
    fallbackReason: string,
  ): IntentClassificationResult {
    const text = userMessage.toLowerCase();

    if (
      text.includes('precio') ||
      text.includes('costo') ||
      text.includes('cuánto') ||
      text.includes('cuanto') ||
      text.includes('inversión') ||
      text.includes('inversion') ||
      text.includes('tarifa')
    ) {
      return {
        intent: 'PRECIO',
        confidence: 0.8,
        shouldUsePredefinedResponse: true,
        shouldUseRag: false,
        requiresHuman: false,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('inscrib') ||
      text.includes('matricul') ||
      text.includes('vacante') ||
      text.includes('participar') ||
      text.includes('registrarme')
    ) {
      return {
        intent: 'INSCRIPCION',
        confidence: 0.8,
        shouldUsePredefinedResponse: true,
        shouldUseRag: false,
        requiresHuman: true,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('certificado') ||
      text.includes('constancia') ||
      text.includes('diploma') ||
      text.includes('certificación') ||
      text.includes('certificacion')
    ) {
      return {
        intent: 'CERTIFICADO',
        confidence: 0.8,
        shouldUsePredefinedResponse: true,
        shouldUseRag: false,
        requiresHuman: false,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('virtual') ||
      text.includes('presencial') ||
      text.includes('online') ||
      text.includes('modalidad')
    ) {
      return {
        intent: 'MODALIDAD',
        confidence: 0.8,
        shouldUsePredefinedResponse: true,
        shouldUseRag: false,
        requiresHuman: false,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('asesor') ||
      text.includes('persona') ||
      text.includes('humano') ||
      text.includes('llamar') ||
      text.includes('atención personalizada') ||
      text.includes('atencion personalizada')
    ) {
      return {
        intent: 'HUMANO',
        confidence: 0.8,
        shouldUsePredefinedResponse: true,
        shouldUseRag: false,
        requiresHuman: true,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('programa') ||
      text.includes('programas') ||
      text.includes('diplomado') ||
      text.includes('diplomados') ||
      text.includes('curso') ||
      text.includes('cursos') ||
      text.includes('ofrecen') ||
      text.includes('brindan') ||
      text.includes('información') ||
      text.includes('informacion')
    ) {
      return {
        intent: 'INFORMACION_PROGRAMA',
        confidence: 0.75,
        shouldUsePredefinedResponse: false,
        shouldUseRag: true,
        requiresHuman: false,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('fecha') ||
      text.includes('inicio') ||
      text.includes('inicia') ||
      text.includes('horario') ||
      text.includes('duración') ||
      text.includes('duracion') ||
      text.includes('cronograma')
    ) {
      return {
        intent: 'HORARIO',
        confidence: 0.75,
        shouldUsePredefinedResponse: false,
        shouldUseRag: true,
        requiresHuman: false,
        reason: fallbackReason,
      };
    }

    if (
      text.includes('requisito') ||
      text.includes('requisitos') ||
      text.includes('documentos') ||
      text.includes('necesito para participar')
    ) {
      return {
        intent: 'REQUISITOS',
        confidence: 0.75,
        shouldUsePredefinedResponse: false,
        shouldUseRag: true,
        requiresHuman: false,
        reason: fallbackReason,
      };
    }

    return {
      intent: 'OTRO',
      confidence: 0.5,
      shouldUsePredefinedResponse: false,
      shouldUseRag: false,
      requiresHuman: false,
      reason: fallbackReason,
    };
  }

  /**
   * Clasifica la intención del usuario.
   *
   * IMPORTANTE:
   * Este método NO responde al cliente.
   * Solo decide qué tipo de mensaje es.
   *
   * Ejemplo:
   * - "cuánto cuesta" => PRECIO
   * - "quiero inscribirme" => INSCRIPCION
   * - "me das mi certificado" => CERTIFICADO
   * - "quiero hablar con alguien" => HUMANO
   */
  async classifyUserIntent(params: {
    tenantName: string;
    businessType: string;
    businessInfo?: string | null;
    services?: string | null;
    userMessage: string;
  }): Promise<IntentClassificationResult> {
    const { tenantName, businessType, businessInfo, services, userMessage } =
      params;

    if (!this.client) {
      return this.classifyUserIntentLocally(
        userMessage,
        'No se configuró OPENAI_API_KEY. Se usó clasificación local básica.',
      );
    }

    const model =
      this.configService.get<string>('DEFAULT_OPENAI_MODEL') || 'gpt-4o-mini';

    try {
      const response = await this.client.responses.parse({
        model,
        input: [
          {
            role: 'system',
            content: `
Eres un clasificador de intención para un agente de WhatsApp.

Tu tarea NO es responder al usuario.
Tu tarea es clasificar el mensaje para decidir cómo debe responder el sistema.

Negocio:
${tenantName}

Tipo de negocio:
${businessType}

Información del negocio:
${businessInfo || 'No registrada.'}

Servicios:
${services || 'No registrados.'}

Criterios:
- PRECIO: pregunta por costo, inversión, pago, tarifa o cuánto cuesta.
- INSCRIPCION: quiere matricularse, registrarse, separar vacante o participar.
- CERTIFICADO: pregunta por diploma, certificado, constancia o certificación.
- MODALIDAD: pregunta si es virtual, presencial, online o mixto.
- HORARIO: pregunta por fechas, duración, inicio, horarios o cronograma.
- INFORMACION_PROGRAMA: pide información general sobre un diplomado, curso o programa.
- REQUISITOS: pregunta por requisitos, documentos o condiciones para participar.
- PAGO: habla de pagar, voucher, transferencia, medios de pago.
- HUMANO: pide asesor, persona, llamada o atención personalizada.
- RECLAMO: queja, problema, demora, error, molestia o reclamo.
- SALUDO: saludo simple.
- OTRO: no encaja claramente.

Reglas:
- Si el usuario quiere comprar, inscribirse o pagar, requiresHuman puede ser true.
- Si necesita información específica del negocio, shouldUseRag debe ser true.
- Si hay una respuesta predefinida probable, shouldUsePredefinedResponse debe ser true.
- Devuelve solo la estructura solicitada.
        `.trim(),
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        text: {
          format: zodTextFormat(
            IntentClassificationSchema,
            'intent_classification',
          ),
        },
      });

      if (!response.output_parsed) {
        this.logger.warn(
          'OpenAI no devolvió output_parsed para la clasificación de intención. Se usará fallback local.',
        );

        return this.classifyUserIntentLocally(
          userMessage,
          'OpenAI no devolvió una clasificación parseada. Se usó fallback local.',
        );
      }

      return response.output_parsed;
    } catch (error) {
      this.logger.error('Error clasificando intención con OpenAI', error);

      return this.classifyUserIntentLocally(
        userMessage,
        'Ocurrió un error clasificando con OpenAI. Se usó fallback local.',
      );
    }
  }

  async generateAgentReply(
    params: GenerateAgentReplyParams,
  ): Promise<GenerateAgentReplyResult> {
    const {
      tenantName,
      businessType,
      tone,
      objective,
      businessInfo,
      services,
      fixedRules,
      humanHandoffRules,
      knowledgeContext,
      userMessage,
      recentMessages,
    } = params;

    /**
     * Modo seguro para desarrollo:
     * Si todavía no configuraste OPENAI_API_KEY,
     * devolvemos una respuesta simulada.
     */
    if (!this.client) {
      return {
        text: `Gracias por escribir a ${tenantName}. Por ahora estoy en modo prueba, pero puedo ayudarte si me indicas qué servicio necesitas.`,
        tokensInput: 0,
        tokensOutput: 0,
      };
    }

    const systemPrompt = `
Eres un agente comercial de WhatsApp para el negocio: ${tenantName}.

Tipo de negocio:
${businessType}

Tono de comunicación:
${tone || 'Amable, claro, breve y profesional.'}

Objetivo principal:
${objective || 'Atender al usuario, resolver dudas y guiarlo hacia una acción comercial.'}

Información del negocio:
${businessInfo || 'No hay información adicional registrada.'}

Servicios disponibles:
${services || 'No hay servicios registrados.'}

Información recuperada de la base de conocimiento:
${knowledgeContext || 'No se recuperó información específica de la base de conocimiento.'}

Reglas comerciales:
${fixedRules || 'No inventes información que no conozcas.'}

Reglas de derivación a humano:
${humanHandoffRules || 'Deriva a humano si el usuario quiere pagar, reclama o pide hablar con una persona.'}

INSTRUCCIONES IMPORTANTES:
- Responde en español.
- Responde como WhatsApp: breve, natural y directo.
- Si hay información recuperada de la base de conocimiento, úsala como fuente principal.
- No inventes precios, horarios ni promociones si no están en la información del negocio o en la base de conocimiento.
- Si falta información, pide un dato concreto al usuario.
- Si la base de conocimiento no alcanza para responder, pide el programa específico o deriva a un asesor.
- No des respuestas largas.
- Tu objetivo es guiar al usuario hacia una consulta, cita, compra o contacto con asesor.
`.trim();

    const historial = recentMessages
      .slice(-6)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n');

    const input = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      {
        role: 'user' as const,
        content: `
Historial reciente:
${historial || 'Sin historial previo.'}

Mensaje actual del usuario:
${userMessage}
`.trim(),
      },
    ];

    const model =
      this.configService.get<string>('DEFAULT_OPENAI_MODEL') || 'gpt-5.4-mini';

    const response = await this.client.responses.create({
      model,
      input,
    });

    const responseAny = response as any;

    return {
      text:
        response.output_text ||
        'Gracias por escribirnos. ¿Podrías darme un poco más de detalle para ayudarte mejor?',
      tokensInput: responseAny.usage?.input_tokens ?? 0,
      tokensOutput: responseAny.usage?.output_tokens ?? 0,
    };
  }
}
