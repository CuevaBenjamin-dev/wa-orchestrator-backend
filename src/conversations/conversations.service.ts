import { Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ConversationsService maneja el historial conversacional.
 *
 * Conversation = conversación general con un lead.
 * Message = mensaje individual dentro de esa conversación.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateConversation(params: { tenantId: string; leadId: string }) {
    const { tenantId, leadId } = params;

    const existingConversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        leadId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (existingConversation) {
      return existingConversation;
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        leadId,
      },
    });
  }

  async addMessage(params: {
    conversationId: string;
    role: MessageRole;
    content: string;
    externalId?: string;
    tokensInput?: number;
    tokensOutput?: number;
  }) {
    const {
      conversationId,
      role,
      content,
      externalId,
      tokensInput = 0,
      tokensOutput = 0,
    } = params;

    return this.prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        externalId,
        tokensInput,
        tokensOutput,
      },
    });
  }

  /**
   * Obtiene los últimos mensajes de una conversación.
   * Esto le da contexto al agente de IA.
   */
  async getRecentMessages(conversationId: string, limit = 6) {
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    /**
     * Los traemos descendente por eficiencia,
     * pero los devolvemos en orden natural.
     */
    return messages.reverse();
  }

  /**
   * Busca un mensaje por el ID externo de WhatsApp.
   *
   * Esto evita procesar dos veces el mismo mensaje si Meta
   * reintenta enviar el webhook.
   */
  async findByExternalId(externalId: string) {
    return this.prisma.message.findUnique({
      where: {
        externalId,
      },
    });
  }
}
