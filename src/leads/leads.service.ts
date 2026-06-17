import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LeadsService maneja personas interesadas que escriben por WhatsApp.
 *
 * Ejemplo:
 * - María escribe a una clínica preguntando por ortodoncia.
 * - El sistema la guarda como lead.
 */
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateLead(params: {
    tenantId: string;
    phone: string;
    name?: string;
  }) {
    const { tenantId, phone, name } = params;

    return this.prisma.lead.upsert({
      where: {
        tenantId_phone: {
          tenantId,
          phone,
        },
      },
      update: {
        name: name || undefined,
      },
      create: {
        tenantId,
        phone,
        name,
        status: 'NEW',
      },
    });
  }
}
