import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeText(text: string) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  async evaluateMessage(params: {
    tenantId: string;
    message: string;
    tenantName: string;
    businessType: string;
  }) {
    const { tenantId, message } = params;

    const texto = this.normalizeText(message);

    /**
     * Buscamos respuestas predefinidas activas del negocio.
     * Primero las de mayor prioridad.
     */
    const predefinedResponses = await this.prisma.predefinedResponse.findMany({
      where: {
        tenantId,
        isActive: true,
        matchType: 'KEYWORD',
      },
      orderBy: {
        priority: 'asc',
      },
    });

    for (const rule of predefinedResponses) {
      const matched = rule.keywords.some((keyword) => {
        const normalizedKeyword = this.normalizeText(keyword);
        return texto.includes(normalizedKeyword);
      });

      if (matched) {
        return {
          answeredByRule: true,
          requiresHuman: rule.requiresHuman,
          reason: `PREDEFINED_RESPONSE:${rule.name}`,
          reply: rule.response,
        };
      }
    }

    return {
      answeredByRule: false,
      requiresHuman: false,
      reason: 'NEEDS_AI',
      reply: null,
    };
  }

  /**
   * Busca una respuesta predefinida por intención.
   *
   * Ejemplo:
   * intent = PRECIO
   * busca una respuesta activa del tenant con matchType = INTENT
   */
  async findPredefinedResponseByIntent(params: {
    tenantId: string;
    intent: string;
  }) {
    const { tenantId, intent } = params;

    return this.prisma.predefinedResponse.findFirst({
      where: {
        tenantId,
        isActive: true,
        matchType: 'INTENT',
        intent,
      },
      orderBy: {
        priority: 'asc',
      },
    });
  }
}
