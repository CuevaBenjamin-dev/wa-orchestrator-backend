import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TenantsService maneja los negocios/clientes.
 *
 * En este MVP, cada tenant representa un negocio:
 * - Clínica
 * - Gimnasio
 * - Colegio
 * - Estudio jurídico
 */
@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.tenant.findMany({
      include: {
        agentConfig: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Busca un negocio usando el phone_number_id de WhatsApp Cloud API.
   *
   * Este dato viene dentro del webhook de Meta:
   * value.metadata.phone_number_id
   */
  async findByWhatsappPhoneId(whatsappPhoneId: string) {
    return this.prisma.tenant.findUnique({
      where: {
        whatsappPhoneId,
      },
      include: {
        agentConfig: true,
      },
    });
  }

  async createDemoTenant() {
    return this.prisma.tenant.create({
      data: {
        name: 'Clínica Sana Demo',
        businessType: 'CLINICA',
        whatsappPhoneId: 'demo_phone_id_clinica_sana',
        status: 'ACTIVE',
        agentConfig: {
          create: {
            tone: 'Amable, profesional y claro',
            objective: 'Agendar citas médicas y resolver dudas frecuentes',
            businessInfo:
              'Clínica local que atiende medicina general, odontología y pediatría.',
            services:
              'Medicina general, odontología, pediatría, laboratorio básico.',
            fixedRules:
              'No dar diagnósticos médicos. Si el usuario menciona emergencia, derivar a humano.',
            humanHandoffRules:
              'Derivar a humano si el usuario quiere pagar, reclama, pide asesor o menciona una emergencia.',
          },
        },
      },
      include: {
        agentConfig: true,
      },
    });
  }

  /**
   * Actualiza el phone_number_id de WhatsApp de un negocio.
   *
   * Esto sirve cuando pasamos de pruebas simuladas
   * a usar el número real de Meta WhatsApp Cloud API.
   */
  async updateWhatsappPhoneId(params: {
    tenantId: string;
    whatsappPhoneId: string;
  }) {
    const { tenantId, whatsappPhoneId } = params;

    return this.prisma.tenant.update({
      where: {
        id: tenantId,
      },
      data: {
        whatsappPhoneId,
      },
      include: {
        agentConfig: true,
      },
    });
  }

  async createColegioAbogadosCallaoTenant() {
    return this.prisma.tenant.create({
      data: {
        name: 'Área de Diplomados y Cursos del Colegio de Abogados del Callao',
        businessType: 'EDUCACION_LEGAL',
        whatsappPhoneId: 'pending_colegio_abogados_callao',
        status: 'ACTIVE',

        agentConfig: {
          create: {
            tone: 'Formal, amable, claro y orientado a inscripción.',
            objective:
              'Informar sobre diplomados, cursos y programas de capacitación, resolver dudas frecuentes y guiar al interesado hacia la inscripción.',
            businessInfo:
              'Área de Diplomados y Cursos del Colegio de Abogados del Callao. Ofrece formación académica, diplomados, cursos de actualización y programas de especialización para abogados, estudiantes de derecho y profesionales interesados.',
            services:
              'Diplomados, cursos de capacitación, cursos de actualización, programas de especialización, certificaciones académicas y actividades formativas jurídicas.',
            fixedRules:
              'No inventar precios, fechas, horarios ni enlaces si no están registrados. Si falta información, pedir el dato específico o derivar a un asesor.',
            humanHandoffRules:
              'Derivar a humano si el usuario solicita inscripción inmediata, pago, constancia, certificado, reclamo, validación de matrícula o atención personalizada.',
          },
        },

        predefinedResponses: {
          create: [
            {
              name: 'Saludo inicial',
              matchType: 'KEYWORD',
              keywords: [
                'hola',
                'buenas',
                'buenos días',
                'buenas tardes',
                'buenas noches',
              ],
              response:
                'Hola 👋 Bienvenido al Área de Diplomados y Cursos del Colegio de Abogados del Callao. Con gusto te ayudo. ¿Buscas información sobre diplomados, cursos, certificados o inscripción?',
              priority: 10,
            },
            {
              name: 'Consulta por precios',
              matchType: 'KEYWORD',
              keywords: [
                'precio',
                'costo',
                'cuánto cuesta',
                'cuanto cuesta',
                'pago',
                'tarifa',
                'inversión',
                'inversion',
              ],
              response:
                'Claro. Para brindarte el costo correcto, indícame por favor qué programa te interesa: diplomado, curso de capacitación, curso de actualización o programa de especialización.',
              priority: 20,
            },
            {
              name: 'Consulta por inscripción',
              matchType: 'KEYWORD',
              keywords: [
                'inscripción',
                'inscripcion',
                'matrícula',
                'matricula',
                'inscribirme',
                'registrarme',
                'quiero participar',
              ],
              response:
                'Perfecto. Para ayudarte con la inscripción, indícame por favor tu nombre completo, el programa de interés y si deseas que un asesor te contacte para continuar con el proceso.',
              priority: 30,
              requiresHuman: true,
            },
            {
              name: 'Consulta por certificados',
              matchType: 'KEYWORD',
              keywords: [
                'certificado',
                'constancia',
                'certificación',
                'certificacion',
                'diploma',
              ],
              response:
                'Sí, los programas pueden incluir certificación según las condiciones del curso o diplomado. Para confirmarte los detalles exactos, dime qué programa te interesa.',
              priority: 40,
            },
            {
              name: 'Consulta por modalidades',
              matchType: 'KEYWORD',
              keywords: [
                'virtual',
                'presencial',
                'modalidad',
                'online',
                'clases',
              ],
              response:
                'La modalidad puede variar según el programa. Indícame el diplomado o curso de tu interés y te ayudo a confirmar si es virtual, presencial o mixto.',
              priority: 50,
            },
            {
              name: 'Hablar con asesor',
              matchType: 'KEYWORD',
              keywords: [
                'asesor',
                'humano',
                'persona',
                'atención personalizada',
                'atencion personalizada',
                'llamar',
              ],
              response:
                'Claro, puedo derivarte con un asesor. Por favor indícame tu nombre completo, tu consulta y el programa que te interesa.',
              priority: 5,
              requiresHuman: true,
            },
          ],
        },

        knowledgeItems: {
          create: [
            {
              title: 'Tipos de programas',
              category: 'PROGRAMAS',
              content:
                'El área ofrece diplomados, cursos de capacitación, cursos de actualización y programas de especialización relacionados con temas jurídicos y profesionales.',
              priority: 10,
            },
            {
              title: 'Objetivo de atención',
              category: 'VENTAS',
              content:
                'El agente debe orientar al interesado, resolver dudas frecuentes y guiarlo hacia la inscripción o contacto con un asesor cuando exista intención clara de matrícula.',
              priority: 20,
            },
            {
              title: 'Regla de no invención',
              category: 'SEGURIDAD',
              content:
                'Si el usuario pregunta por precios, fechas, horarios, docentes, enlaces de pago o requisitos no registrados, el agente no debe inventar información. Debe pedir el programa específico o derivar a un asesor.',
              priority: 5,
            },
          ],
        },
      },
      include: {
        agentConfig: true,
        predefinedResponses: true,
        knowledgeItems: true,
      },
    });
  }

  async seedIntentResponsesForTenant(tenantId: string) {
    await this.prisma.predefinedResponse.deleteMany({
      where: {
        tenantId,
        matchType: 'INTENT',
      },
    });

    return this.prisma.predefinedResponse.createMany({
      data: [
        {
          tenantId,
          name: 'INTENT - Precio',
          matchType: 'INTENT',
          intent: 'PRECIO',
          response:
            'Claro. Para indicarte el costo correcto, dime por favor qué programa te interesa: diplomado, curso de capacitación, curso de actualización o programa de especialización.',
          priority: 10,
        },
        {
          tenantId,
          name: 'INTENT - Inscripción',
          matchType: 'INTENT',
          intent: 'INSCRIPCION',
          response:
            'Perfecto. Para ayudarte con la inscripción, indícame tu nombre completo, el programa de interés y un número de contacto. Un asesor puede ayudarte a continuar el proceso.',
          priority: 20,
          requiresHuman: true,
        },
        {
          tenantId,
          name: 'INTENT - Certificado',
          matchType: 'INTENT',
          intent: 'CERTIFICADO',
          response:
            'Sí, puedo ayudarte con información sobre certificados. Indícame por favor el nombre del programa o curso para confirmarte los detalles correspondientes.',
          priority: 30,
        },
        {
          tenantId,
          name: 'INTENT - Modalidad',
          matchType: 'INTENT',
          intent: 'MODALIDAD',
          response:
            'La modalidad puede variar según el programa. Indícame qué diplomado o curso te interesa y te ayudo a confirmar si es virtual, presencial o mixto.',
          priority: 40,
        },
        {
          tenantId,
          name: 'INTENT - Horario',
          matchType: 'INTENT',
          intent: 'HORARIO',
          response:
            'Las fechas y horarios dependen del programa. Dime cuál te interesa y te ayudo a revisar la información disponible.',
          priority: 50,
        },
        {
          tenantId,
          name: 'INTENT - Humano',
          matchType: 'INTENT',
          intent: 'HUMANO',
          response:
            'Claro, puedo derivarte con un asesor. Por favor indícame tu nombre completo, tu consulta y el programa que te interesa.',
          priority: 5,
          requiresHuman: true,
        },
        {
          tenantId,
          name: 'INTENT - Reclamo',
          matchType: 'INTENT',
          intent: 'RECLAMO',
          response:
            'Lamento el inconveniente. Para ayudarte mejor, por favor indícame tu nombre completo, el detalle del caso y el programa relacionado. Un asesor deberá revisar tu solicitud.',
          priority: 1,
          requiresHuman: true,
        },
      ],
      skipDuplicates: false,
    });
  }

  async seedKnowledgeItemsForTenant(tenantId: string) {
    await this.prisma.knowledgeItem.deleteMany({
      where: {
        tenantId,
      },
    });

    return this.prisma.knowledgeItem.createMany({
      data: [
        {
          tenantId,
          title: 'Descripción general del área',
          category: 'GENERAL',
          content:
            'El Área de Diplomados y Cursos del Colegio de Abogados del Callao brinda Diplomados y Cursos, y la certificación es inmediata. Se le envía en digital PDF (virtual) y en físico por agencia de envío. Principalmente brindamos la certificación inmediata.',
          priority: 1,
        },
        {
          tenantId,
          title: 'Tipos de programas disponibles',
          category: 'PROGRAMAS',
          content:
            'Se pueden ofrecer diplomados, cursos de capacitación, cursos de actualización y programas de especialización en cualquier mención, para cualquier área, rama o especialidad en Derecho.',
          priority: 5,
        },
        {
          tenantId,
          title: 'Modalidad de clases',
          category: 'MODALIDAD',
          content:
            'No ofrecemos clases. Nosotros brindamos Diplomado(s) y Curso(s) sin la necesidad de tener que llevar las clases como tal. Se le entrega en físico y en digital PDF (virtual).',
          priority: 20,
        },
        {
          tenantId,
          title: 'Fechas y horarios',
          category: 'HORARIOS',
          content:
            'No ofrecemos clases por lo tanto no hay fechas ni horarios. Nosotros brindamos Diplomado(s) y Curso(s) sin la necesidad de tener que llevar las clases como tal. Se le entrega en físico y en digital PDF (virtual).',
          priority: 30,
        },
        {
          tenantId,
          title: 'Certificación',
          category: 'CERTIFICADOS',
          content:
            'La Certificación es inmediata, todo se le envía hoy mismo en digital PDF (virtual) y en físico por agencia de envío.',
          priority: 40,
        },
        {
          tenantId,
          title: 'Precios e inversión',
          category: 'PAGOS',
          content:
            'No se debe informar un precio si no está registrado. Si el usuario pregunta por costo, inversión, tarifa o medios de pago, se debe pedir el programa específico y ofrecer derivación a un asesor.',
          priority: 50,
        },
        {
          tenantId,
          title: 'Requisitos generales',
          category: 'REQUISITOS',
          content:
            'Lo único que se requiere son sus nombres completos, y las menciones elegidas para su Diplomado o Curso. No se requiere enviar ningún documento ni cumplir con algún requisito adicional para la inscripción.',
          priority: 60,
        },
        {
          tenantId,
          title: 'Derivación a asesor',
          category: 'VENTAS',
          content:
            'Se debe derivar a un asesor cuando el usuario quiera inscribirse, pagar, separar vacante, enviar voucher, solicitar certificado, reclamar o pedir atención personalizada. En ese caso solo se le indica que se validará el pago realizado.',
          priority: 2,
        },
      ],
    });
  }

  async updateAgentConfigForTenant(params: {
    tenantId: string;
    tone?: string;
    objective?: string;
    businessInfo?: string;
    services?: string;
    fixedRules?: string;
    humanHandoffRules?: string;
  }) {
    const {
      tenantId,
      tone,
      objective,
      businessInfo,
      services,
      fixedRules,
      humanHandoffRules,
    } = params;

    return this.prisma.tenant.update({
      where: {
        id: tenantId,
      },
      data: {
        agentConfig: {
          upsert: {
            create: {
              tone:
                tone ??
                'Formal, amable, claro, institucional y orientado a inscripción.',
              objective:
                objective ??
                'Informar sobre diplomados, cursos y programas, resolver dudas frecuentes y guiar al interesado hacia la inscripción.',
              businessInfo:
                businessInfo ??
                'Área de Diplomados y Cursos del Colegio de Abogados del Callao.',
              services:
                services ??
                'Diplomados, cursos de capacitación, cursos de actualización y programas de especialización.',
              fixedRules:
                fixedRules ??
                'No inventar precios, fechas, horarios, docentes, enlaces de pago ni promociones si no están registrados en la base de conocimiento.',
              humanHandoffRules:
                humanHandoffRules ??
                'Derivar a un asesor si el usuario quiere inscribirse, pagar, separar vacante, enviar voucher, consultar certificado, reclamar o pedir atención personalizada.',
            },
            update: {
              ...(tone !== undefined ? { tone } : {}),
              ...(objective !== undefined ? { objective } : {}),
              ...(businessInfo !== undefined ? { businessInfo } : {}),
              ...(services !== undefined ? { services } : {}),
              ...(fixedRules !== undefined ? { fixedRules } : {}),
              ...(humanHandoffRules !== undefined ? { humanHandoffRules } : {}),
            },
          },
        },
      },
      include: {
        agentConfig: true,
        predefinedResponses: true,
        knowledgeItems: true,
      },
    });
  }
}
