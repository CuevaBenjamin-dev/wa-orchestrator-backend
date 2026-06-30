import { Injectable } from '@nestjs/common';
import {
  IpdeOutboundDelivery,
  IpdeOutboundDeliveryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IpdePlannedOutboundDelivery } from './ipde-outbound-delivery.types';

export type IpdeOutboundDeliveryWithRouting =
  Prisma.IpdeOutboundDeliveryGetPayload<{
    include: {
      tenant: { select: { whatsappPhoneId: true } };
      lead: { select: { phone: true } };
    };
  }>;

@Injectable()
export class IpdeOutboundDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createFromPlan(params: {
    tenantId: string;
    leadId?: string;
    conversationId: string;
    orderId?: string | null;
    inboundMessageId?: string;
    inboundExternalId: string;
    maxAttempts: number;
    planned: IpdePlannedOutboundDelivery[];
  }): Promise<IpdeOutboundDelivery[]> {
    if (params.planned.length === 0) {
      return [];
    }

    return this.prisma.$transaction(async (tx) => {
      for (const delivery of params.planned) {
        await tx.ipdeOutboundDelivery.upsert({
          where: {
            tenantId_inboundExternalId_sequence: {
              tenantId: params.tenantId,
              inboundExternalId: params.inboundExternalId,
              sequence: delivery.sequence,
            },
          },
          update: {},
          create: {
            tenantId: params.tenantId,
            leadId: params.leadId,
            conversationId: params.conversationId,
            orderId: params.orderId ?? undefined,
            inboundMessageId: params.inboundMessageId,
            inboundExternalId: params.inboundExternalId,
            actionType: delivery.actionType,
            sequence: delivery.sequence,
            payloadJson: delivery.payload,
            maxAttempts: params.maxAttempts,
          },
        });
      }

      return tx.ipdeOutboundDelivery.findMany({
        where: {
          tenantId: params.tenantId,
          inboundExternalId: params.inboundExternalId,
        },
        orderBy: { sequence: 'asc' },
      });
    });
  }

  findByInbound(params: {
    tenantId: string;
    inboundExternalId: string;
  }): Promise<IpdeOutboundDelivery[]> {
    return this.prisma.ipdeOutboundDelivery.findMany({
      where: {
        tenantId: params.tenantId,
        inboundExternalId: params.inboundExternalId,
      },
      orderBy: { sequence: 'asc' },
    });
  }

  findExecutableByInbound(params: {
    tenantId: string;
    inboundExternalId: string;
    now: Date;
  }): Promise<IpdeOutboundDelivery[]> {
    return this.prisma.ipdeOutboundDelivery.findMany({
      where: {
        tenantId: params.tenantId,
        inboundExternalId: params.inboundExternalId,
        status: IpdeOutboundDeliveryStatus.PENDING,
        scheduledAt: { lte: params.now },
      },
      orderBy: { sequence: 'asc' },
    });
  }

  findPending(params: {
    tenantId: string;
    limit: number;
    now: Date;
  }): Promise<IpdeOutboundDeliveryWithRouting[]> {
    return this.prisma.ipdeOutboundDelivery.findMany({
      where: {
        tenantId: params.tenantId,
        status: IpdeOutboundDeliveryStatus.PENDING,
        scheduledAt: { lte: params.now },
      },
      include: {
        tenant: { select: { whatsappPhoneId: true } },
        lead: { select: { phone: true } },
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      take: params.limit,
    });
  }

  async markSending(id: string): Promise<IpdeOutboundDelivery | null> {
    const result = await this.prisma.ipdeOutboundDelivery.updateMany({
      where: { id, status: IpdeOutboundDeliveryStatus.PENDING },
      data: {
        status: IpdeOutboundDeliveryStatus.SENDING,
        attemptCount: { increment: 1 },
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.ipdeOutboundDelivery.findUnique({ where: { id } });
  }

  markSent(params: {
    id: string;
    providerMessageId: string | null;
    now: Date;
  }): Promise<IpdeOutboundDelivery> {
    return this.prisma.ipdeOutboundDelivery.update({
      where: { id: params.id },
      data: {
        status: IpdeOutboundDeliveryStatus.SENT,
        providerMessageId: params.providerMessageId,
        sentAt: params.now,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  markSkipped(params: {
    id: string;
    code: string;
    message: string;
  }): Promise<IpdeOutboundDelivery> {
    return this.prisma.ipdeOutboundDelivery.update({
      where: { id: params.id },
      data: {
        status: IpdeOutboundDeliveryStatus.SKIPPED,
        lastErrorCode: params.code,
        lastErrorMessage: params.message,
      },
    });
  }

  markPendingRetry(params: {
    id: string;
    code: string;
    message: string;
    scheduledAt: Date;
  }): Promise<IpdeOutboundDelivery> {
    return this.prisma.ipdeOutboundDelivery.update({
      where: { id: params.id },
      data: {
        status: IpdeOutboundDeliveryStatus.PENDING,
        lastErrorCode: params.code,
        lastErrorMessage: params.message,
        scheduledAt: params.scheduledAt,
        failedAt: null,
      },
    });
  }

  markFailed(params: {
    id: string;
    code: string;
    message: string;
    now: Date;
  }): Promise<IpdeOutboundDelivery> {
    return this.prisma.ipdeOutboundDelivery.update({
      where: { id: params.id },
      data: {
        status: IpdeOutboundDeliveryStatus.FAILED,
        lastErrorCode: params.code,
        lastErrorMessage: params.message,
        failedAt: params.now,
      },
    });
  }
}
