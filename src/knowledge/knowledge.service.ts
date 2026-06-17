import { Injectable } from '@nestjs/common';
import { KnowledgeItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type RetrievedKnowledgeItem = KnowledgeItem & {
  score: number;
  matchedTerms: string[];
};

/**
 * KnowledgeService maneja la base de conocimiento del negocio.
 *
 * En este MVP hacemos un RAG liviano:
 * - No usamos embeddings todavía.
 * - No usamos pgvector todavía.
 * - Buscamos información por intención, categoría y coincidencia de palabras.
 *
 * Más adelante podremos mejorar esto con búsqueda semántica.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeText(text: string) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractSearchTerms(text: string) {
    const normalized = this.normalizeText(text);

    const stopWords = new Set([
      'que',
      'cual',
      'cuál',
      'como',
      'cómo',
      'para',
      'con',
      'del',
      'los',
      'las',
      'una',
      'uno',
      'por',
      'favor',
      'quiero',
      'quisiera',
      'deseo',
      'me',
      'mi',
      'el',
      'la',
      'de',
      'y',
      'o',
      'a',
      'en',
      'es',
      'son',
      'hay',
      'tienen',
      'tiene',
    ]);

    return normalized
      .split(' ')
      .map((word) => word.trim())
      .filter((word) => word.length >= 4)
      .filter((word) => !stopWords.has(word));
  }

  private getCategoriesByIntent(intent?: string | null) {
    switch (intent) {
      case 'INFORMACION_PROGRAMA':
        return ['PROGRAMAS'];
      case 'HORARIO':
        return ['HORARIOS', 'PROGRAMAS'];
      case 'REQUISITOS':
        return ['REQUISITOS'];
      case 'MODALIDAD':
        return ['MODALIDAD', 'PROGRAMAS'];
      case 'CERTIFICADO':
        return ['CERTIFICADOS', 'PROGRAMAS'];
      case 'PAGO':
        return ['PAGOS'];
      default:
        return [];
    }
  }

  private scoreItem(params: {
    item: KnowledgeItem;
    terms: string[];
    categories: string[];
  }) {
    const { item, terms, categories } = params;

    const haystack = this.normalizeText(
      `${item.title} ${item.category ?? ''} ${item.content}`,
    );

    const matchedTerms = terms.filter((term) => haystack.includes(term));

    const categoryScore =
      item.category && categories.includes(item.category) ? 3 : 0;

    const textScore = matchedTerms.length * 2;

    /**
     * Mientras menor priority, más importante.
     * Convertimos eso en un pequeño puntaje positivo.
     */
    const priorityScore = Math.max(0, 100 - item.priority) / 100;

    return {
      score: categoryScore + textScore + priorityScore,
      matchedTerms,
    };
  }

  /**
   * Busca información relevante para responder.
   *
   * Este es nuestro RAG liviano.
   */
  async searchRelevantKnowledgeItems(params: {
    tenantId: string;
    userMessage: string;
    intent?: string | null;
    limit?: number;
  }): Promise<RetrievedKnowledgeItem[]> {
    const { tenantId, userMessage, intent, limit = 5 } = params;

    const categories = this.getCategoriesByIntent(intent);

    let items = await this.prisma.knowledgeItem.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(categories.length > 0
          ? {
              category: {
                in: categories,
              },
            }
          : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 80,
    });

    /**
     * Si por categoría no encontramos nada,
     * buscamos en toda la base de conocimiento del tenant.
     */
    if (items.length === 0) {
      items = await this.prisma.knowledgeItem.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: 80,
      });
    }

    const terms = this.extractSearchTerms(`${intent ?? ''} ${userMessage}`);

    const scoredItems = items
      .map((item) => {
        const { score, matchedTerms } = this.scoreItem({
          item,
          terms,
          categories,
        });

        return {
          ...item,
          score,
          matchedTerms,
        };
      })
      .sort((a, b) => b.score - a.score || a.priority - b.priority);

    /**
     * Si todos tienen score 0, igual devolvemos los más importantes.
     * Esto evita que la IA quede sin contexto.
     */
    const relevantItems = scoredItems.some((item) => item.score > 0)
      ? scoredItems.filter((item) => item.score > 0)
      : scoredItems;

    return relevantItems.slice(0, limit);
  }

  /**
   * Convierte KnowledgeItems en texto para meterlos al prompt.
   */
  buildKnowledgeContext(items: RetrievedKnowledgeItem[]) {
    if (items.length === 0) {
      return null;
    }

    return items
      .map((item, index) => {
        return `
[${index + 1}] ${item.title}
Categoría: ${item.category ?? 'GENERAL'}
Contenido:
${item.content}
        `.trim();
      })
      .join('\n\n');
  }
}
