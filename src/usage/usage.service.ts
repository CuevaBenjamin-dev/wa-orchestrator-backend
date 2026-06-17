import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * UsageService mide el consumo por cliente.
 *
 * Esto será clave para tu modelo de negocio:
 * - mensajes recibidos
 * - respuestas IA usadas
 * - tokens consumidos
 */
@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  private getTodayStart(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  async incrementInboundMessage(tenantId: string) {
    const date = this.getTodayStart();

    return this.prisma.usageDaily.upsert({
      where: {
        tenantId_date: {
          tenantId,
          date,
        },
      },
      update: {
        inboundMessages: {
          increment: 1,
        },
      },
      create: {
        tenantId,
        date,
        inboundMessages: 1,
      },
    });
  }

  async incrementAiUsage(params: {
    tenantId: string;
    tokensInput: number;
    tokensOutput: number;
  }) {
    const { tenantId, tokensInput, tokensOutput } = params;
    const date = this.getTodayStart();

    return this.prisma.usageDaily.upsert({
      where: {
        tenantId_date: {
          tenantId,
          date,
        },
      },
      update: {
        aiResponses: {
          increment: 1,
        },
        tokensInput: {
          increment: tokensInput,
        },
        tokensOutput: {
          increment: tokensOutput,
        },
      },
      create: {
        tenantId,
        date,
        aiResponses: 1,
        tokensInput,
        tokensOutput,
      },
    });
  }
}
