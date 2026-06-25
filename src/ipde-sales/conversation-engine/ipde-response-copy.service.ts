import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PRODUCT_TYPES,
  ProductType,
  SubjectCatalogEntry,
} from '../../catalog/domain/catalog.types';
import {
  IpdeIssuerOption,
  IpdeIssuerVariantRecommendation,
  IpdeModelPdfAsset,
} from '../commercial-config/ipde-commercial-config.types';
import { IpdeProductLabelService } from '../commercial-config/ipde-product-label.service';
import { IpdePriceFormatService } from '../pricing/ipde-price-format.service';
import {
  IpdeQuoteDiscountResult,
  IpdeQuoteOrderResult,
} from '../pricing/ipde-pricing.types';
import { IpdeOutboundAction } from './ipde-conversation-action.schemas';

const DEFAULT_MAX_CHARS = 3000;

@Injectable()
export class IpdeResponseCopyService {
  constructor(
    private readonly config: ConfigService,
    private readonly productLabels: IpdeProductLabelService = new IpdeProductLabelService(),
    private readonly priceFormat: IpdePriceFormatService = new IpdePriceFormatService(),
  ) {}

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
      messageDraft: `¿Qué tipo de producto deseas: ${this.productLabels.getLabels(allowed).join(', ')}?`,
    };
  }

  askIssuerVariant(params?: {
    categoryCode: string | null;
    recommended: IpdeIssuerVariantRecommendation;
    options: IpdeIssuerOption[];
  }): IpdeOutboundAction {
    if (params) {
      const area =
        params.categoryCode === 'DERECHO'
          ? 'Para Derecho'
          : params.categoryCode === 'EDUCACION'
            ? 'Para Educación'
            : 'Para esta área';
      const alternatives = params.options.filter(
        (option) =>
          option.issuerCode !== params.recommended.issuerCode ||
          option.variantCode !== params.recommended.variantCode,
      );
      const alternativeCopy =
        alternatives.length > 0
          ? ` También contamos con ${alternatives
              .map(
                (option) =>
                  `${option.issuerName}, ${option.variantName.toLocaleLowerCase('es')}`,
              )
              .join('; ')}.`
          : '';
      return {
        type: 'ASK_ISSUER_VARIANT',
        configurationPending: false,
        recommended: {
          issuerCode: params.recommended.issuerCode,
          issuerName: params.recommended.issuerName,
          variantCode: params.recommended.variantCode,
          variantName: params.recommended.variantName,
          description: params.recommended.description,
        },
        options: params.options,
        messageDraft: `${area} te recomiendo ${params.recommended.issuerName}: ${params.recommended.description} Avanzaremos con esa opción si la confirmas.${alternativeCopy}`,
      };
    }
    return {
      type: 'ASK_ISSUER_VARIANT',
      configurationPending: true,
      messageDraft:
        'Para continuar necesito que el equipo confirme contigo la variante de emisión disponible. ¿Deseas que la revisemos?',
    };
  }

  offerModelPdfOptions(assets: IpdeModelPdfAsset[]): IpdeOutboundAction {
    const modelPdfAssets = assets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      description: asset.description,
      issuerCode: asset.issuerCode,
      issuerVariantCode: asset.issuerVariantCode,
      productTypeCode: asset.productTypeCode,
    }));
    return {
      type: 'OFFER_MODEL_PDF_OPTIONS',
      modelPdfAssets,
      messageDraft: `Claro, puedo mostrarte los modelos disponibles para que revises la presentación. Tengo estas opciones listas:\n${modelPdfAssets
        .map((asset) => `• ${asset.title}: ${asset.description}`)
        .join('\n')}`,
    };
  }

  quotePrice(quote: IpdeQuoteOrderResult): IpdeOutboundAction {
    const itemCount = quote.appliedRules.length;
    const subject =
      itemCount === 1
        ? 'la opción seleccionada'
        : `las ${itemCount} opciones seleccionadas`;
    const promotionCopy = quote.promotionLabel
      ? ` ${quote.promotionLabel}.`
      : '';
    return {
      type: 'QUOTE_PRICE',
      currencyCode: quote.currencyCode,
      totalRegularAmount: quote.totalRegularAmount,
      totalPromotionalAmount: quote.totalPromotionalAmount,
      promotionLabel: quote.promotionLabel,
      appliedRuleIds: [
        ...new Set(quote.appliedRules.map((rule) => rule.ruleId)),
      ],
      messageDraft: `Perfecto. Para ${subject}, el precio promocional total es ${this.priceFormat.format(
        quote.totalPromotionalAmount,
      )}.${promotionCopy}\n\nPodemos continuar con tus nombres completos para avanzar.`,
    };
  }

  quoteDiscount(discount: IpdeQuoteDiscountResult): IpdeOutboundAction {
    return {
      type: 'QUOTE_DISCOUNT',
      currencyCode: discount.currencyCode,
      currentAmount: discount.currentAmount,
      discountedAmount: discount.discountedAmount,
      discountAvailable: discount.discountAvailable,
      messageDraft: discount.discountAvailable
        ? `Puedo dejártelo en ${this.priceFormat.format(
            discount.discountedAmount,
          )} por promoción.\n\nCon ese monto ya estaríamos manejando el mejor precio disponible.`
        : 'Ya te estoy considerando el precio promocional más bajo disponible para esta opción.',
    };
  }

  priceNotAvailable(
    reason:
      | 'MISSING_TOPICS'
      | 'MISSING_PRODUCT'
      | 'MISSING_ISSUER'
      | 'NO_PRICING_RULE'
      | 'PARTIAL_PRICING',
  ): IpdeOutboundAction {
    const messageDraft =
      reason === 'MISSING_PRODUCT'
        ? 'Para darte el precio exacto, indícame si lo deseas como Diplomado, Especialización o Curso.'
        : reason === 'MISSING_ISSUER'
          ? 'Para calcularlo bien, primero confirmemos la opción de emisión.'
          : reason === 'MISSING_TOPICS'
            ? 'Para darte el precio exacto, primero indícame la materia o los temas que deseas.'
            : 'Estoy revisando la opción exacta para darte el precio correcto. Indícame un momento, por favor.';
    return {
      type: 'PRICE_NOT_AVAILABLE',
      reason,
      messageDraft,
    };
  }

  sendPromotionImage(params: {
    assetId: string;
    categoryCode: string | null;
  }): IpdeOutboundAction {
    return {
      type: 'SEND_PROMOTION_IMAGE',
      assetId: params.assetId,
      categoryCode: params.categoryCode,
      messageDraft:
        'Claro, te comparto la promoción disponible para esta opción.',
    };
  }

  sendPaymentMethodsImage(assetId: string): IpdeOutboundAction {
    return {
      type: 'SEND_PAYMENT_METHODS_IMAGE',
      assetId,
      messageDraft: 'Claro, te envío los medios de pago disponibles.',
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
