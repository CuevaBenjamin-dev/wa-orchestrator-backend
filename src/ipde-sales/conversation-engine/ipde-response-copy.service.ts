import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PRODUCT_TYPES,
  ProductType,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import { IpdeOutboundAction } from './ipde-conversation-action.schemas';

const DEFAULT_MAX_CHARS = 3000;

const PRODUCT_LABELS: Record<ProductType, string> = {
  DIPLOMADO: 'Diplomado',
  ESPECIALIZACION: 'Especialización',
  CURSO: 'Curso',
  CURSO_CAPACITACION: 'Curso de capacitación',
  CURSO_ACTUALIZACION: 'Curso de actualización',
  CURSO_ESPECIALIZACION: 'Curso de especialización',
};

@Injectable()
export class IpdeResponseCopyService {
  constructor(private readonly config: ConfigService) {}

  askSubjectOrDirectTopics(): IpdeOutboundAction {
    return {
      type: 'ASK_SUBJECT_OR_DIRECT_TOPICS',
      messageDraft:
        '¡Hola! 👋 Cuéntame la materia que buscas y te muestro 25 temas, o escríbeme directamente los temas que ya tienes en mente.',
    };
  }

  askSubject(): IpdeOutboundAction {
    return {
      type: 'ASK_SUBJECT',
      messageDraft:
        '¿Qué materia o especialidad necesitas? Con eso preparo la lista de temas disponibles.',
    };
  }

  clarification(reason: string, candidates: string[]): IpdeOutboundAction {
    const options =
      candidates.length > 0 ? ` Opciones: ${candidates.join(', ')}.` : '';
    return {
      type: 'ASK_CLARIFICATION',
      reason,
      candidates,
      messageDraft: `Necesito confirmar un detalle para continuar.${options} ¿Cuál corresponde?`,
    };
  }

  presentTopicList(entry: SubjectCatalogEntry): IpdeOutboundAction {
    const topics = entry.topics.map((topic, index) => ({
      position: index + 1,
      topicId: topic.id,
      topicName: topic.name,
    }));
    const chunks = this.chunkTopicList(entry.displayName, topics);
    return {
      type: 'PRESENT_TOPIC_LIST',
      subjectCatalogEntryId: entry.id,
      subjectDisplayName: entry.displayName,
      source: entry.source,
      topics,
      chunks,
      messageDraft: chunks.map((chunk) => chunk.text).join('\n\n'),
    };
  }

  askTopicSelection(subjectNames: string[]): IpdeOutboundAction {
    return {
      type: 'ASK_TOPIC_SELECTION',
      subjectNames,
      messageDraft:
        'Indícame los números de los temas que deseas. Si hay varias materias, menciona la materia junto a cada número.',
    };
  }

  confirmTopics(topicNames: string[]): IpdeOutboundAction {
    return {
      type: 'CONFIRM_SELECTED_TOPICS',
      topicNames,
      messageDraft: `Perfecto, registré: ${topicNames.join('; ')}.`,
    };
  }

  askProductType(
    allowedProductTypes: ProductType[],
    topicNames: string[],
  ): IpdeOutboundAction {
    const allowed =
      allowedProductTypes.length > 0 ? allowedProductTypes : [...PRODUCT_TYPES];
    return {
      type: 'ASK_PRODUCT_TYPE',
      allowedProductTypes: allowed,
      topicNames,
      messageDraft: `¿Qué tipo de producto deseas: ${allowed.map((code) => PRODUCT_LABELS[code]).join(', ')}?`,
    };
  }

  askIssuerVariant(): IpdeOutboundAction {
    return {
      type: 'ASK_ISSUER_VARIANT',
      configurationPending: true,
      messageDraft:
        'Para continuar necesito que el equipo confirme contigo la variante de emisión disponible. ¿Deseas que la revisemos?',
    };
  }

  askFullName(): IpdeOutboundAction {
    return {
      type: 'ASK_FULL_NAME',
      messageDraft: '¿Cuál es tu nombre completo para registrar el pedido?',
    };
  }

  confirmFullName(fullName: string): IpdeOutboundAction {
    return {
      type: 'CONFIRM_FULL_NAME',
      fullName,
      messageDraft: `Registré el nombre “${fullName}”. ¿Está escrito correctamente?`,
    };
  }

  askOrderConfirmation(topicNames: string[]): IpdeOutboundAction {
    return {
      type: 'ASK_ORDER_CONFIRMATION',
      topicNames,
      messageDraft: `Ya tengo los datos del pedido para ${topicNames.join('; ')}. ¿Confirmas que todo está correcto?`,
    };
  }

  requestHuman(): IpdeOutboundAction {
    return {
      type: 'REQUEST_HUMAN_TAKEOVER',
      reason: 'USER_REQUESTED_HUMAN',
      messageDraft:
        'De acuerdo. Pauso la atención automática para que una persona del equipo continúe contigo.',
    };
  }

  private chunkTopicList(
    subjectName: string,
    topics: Array<{ position: number; topicId: string; topicName: string }>,
  ): Array<{ sequence: number; text: string }> {
    const maxChars = this.getMaxChars();
    const lines = topics.map(
      (topic) => `${topic.position}. ${topic.topicName}`,
    );
    const intro = `Estos son los 25 temas disponibles para ${subjectName}:`;
    const footer =
      'Respóndeme con los números que deseas. Si seleccionas de varias materias, indica también la materia.';
    const chunks: string[] = [];
    let current = intro;

    for (const line of lines) {
      const candidate = `${current}\n${line}`;
      if (candidate.length > maxChars) {
        chunks.push(current);
        current = line;
      } else {
        current = candidate;
      }
    }

    if (`${current}\n\n${footer}`.length > maxChars) {
      chunks.push(current);
      current = footer;
    } else {
      current = `${current}\n\n${footer}`;
    }
    chunks.push(current);
    return chunks.map((text, index) => ({ sequence: index + 1, text }));
  }

  private getMaxChars(): number {
    const raw = Number(
      this.config.get<string>('IPDE_WHATSAPP_TEXT_CHUNK_MAX_CHARS') ??
        DEFAULT_MAX_CHARS,
    );
    return Number.isInteger(raw) && raw >= 500 && raw <= 4000
      ? raw
      : DEFAULT_MAX_CHARS;
  }
}
