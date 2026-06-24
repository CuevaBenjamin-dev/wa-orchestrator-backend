import { Injectable } from '@nestjs/common';
import { IpdeConversationStage } from '@prisma/client';
import { ProductType } from '../../catalog/domain/catalog.types';
import { normalizeCatalogText } from '../../catalog/utils/normalize-catalog-text';
import { IpdeMessageExtractionSchema } from './ipde-understanding.schemas';
import {
  IpdeMessageExtraction,
  IpdeMessageUnderstandingInput,
} from './ipde-understanding.types';

type Intent = IpdeMessageExtraction['primaryIntent'];
type Ambiguity = IpdeMessageExtraction['ambiguities'][number];
type TopicSelection = IpdeMessageExtraction['topicSelections'][number];

@Injectable()
export class IpdeUnderstandingFallbackService {
  understand(input: IpdeMessageUnderstandingInput): IpdeMessageExtraction {
    const text = normalizeCatalogText(input.userMessage);
    const detectedIntents: Intent[] = [];
    const requestedArtifacts: IpdeMessageExtraction['requestedArtifacts'] = [];
    const ambiguities: Ambiguity[] = [];

    const greeting =
      /^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(text);
    const asksForList = /\b(lista|opciones|temas|catalogo)\b/.test(text);
    const asksForModel = /\b(modelo|ejemplo|pdf)\b/.test(text);
    const asksForPrice =
      /\b(precio|costo|cuanto cuesta|inversion|tarifa)\b/.test(text);
    const asksForDiscount = /\b(descuento|rebaja|puede ser menos|menos)\b/.test(
      text,
    );
    const asksForPromotion = /\b(promocion|promo|oferta)\b/.test(text);
    const asksForPaymentMethods =
      /\b(medios? de pago|yape|plin|transferencia)\b/.test(text);
    const wantsHuman =
      /\b(asesor|humano|persona|atencion personalizada)\b/.test(text);
    const mentionsPaymentProof =
      /\b(voucher|comprobante|constancia de pago|mi pago|pago ya|pago fue)\b/.test(
        text,
      );
    const confirms = /^(si|sí|correcto|confirmo|de acuerdo|esta bien)$/.test(
      input.userMessage.trim().toLocaleLowerCase('es'),
    );
    const corrects =
      /\b(no|corrijo|correccion|cambiar|quita|retira|equivocado)\b/.test(text);

    if (greeting) this.addIntent(detectedIntents, 'GREETING');
    if (asksForList) this.addIntent(detectedIntents, 'REQUEST_SUBJECT_LIST');
    if (asksForModel) {
      this.addIntent(detectedIntents, 'REQUEST_MODEL_PDF');
      requestedArtifacts.push('MODEL_PDF');
    }
    if (asksForPrice) this.addIntent(detectedIntents, 'REQUEST_PRICE');
    if (asksForDiscount) this.addIntent(detectedIntents, 'REQUEST_DISCOUNT');
    if (asksForPromotion) {
      this.addIntent(detectedIntents, 'REQUEST_PROMOTION');
      requestedArtifacts.push('PROMOTION_IMAGE');
    }
    if (asksForPaymentMethods) {
      this.addIntent(detectedIntents, 'REQUEST_PAYMENT_METHODS');
      requestedArtifacts.push('PAYMENT_METHODS_IMAGE');
    }
    if (wantsHuman) this.addIntent(detectedIntents, 'REQUEST_HUMAN');
    if (mentionsPaymentProof) {
      this.addIntent(detectedIntents, 'PAYMENT_PROOF_MENTION');
    }
    if (confirms) this.addIntent(detectedIntents, 'CONFIRM');
    if (corrects) this.addIntent(detectedIntents, 'CORRECT_OR_REJECT');

    const productSelections = this.extractProducts(input.userMessage);
    if (productSelections.length > 0) {
      this.addIntent(detectedIntents, 'PROVIDE_PRODUCT_TYPE');
    }

    const topicSelections = this.extractNumericSelections(input, ambiguities);
    if (topicSelections.length > 0) {
      this.addIntent(detectedIntents, 'PROVIDE_TOPIC_SELECTION');
    }

    const fullNameCandidate = this.extractFullName(input, ambiguities);
    if (fullNameCandidate) {
      this.addIntent(detectedIntents, 'PROVIDE_FULL_NAME');
    }

    const issuerPreference = this.extractIssuerPreference(text);
    if (issuerPreference.confidence > 0) {
      this.addIntent(detectedIntents, 'PROVIDE_ISSUER_PREFERENCE');
    }

    const primaryIntent = this.selectPrimaryIntent(detectedIntents);
    const requestPath =
      topicSelections.length > 0
        ? 'DIRECT_TOPICS'
        : asksForList
          ? 'CATALOG_LIST'
          : 'UNDETERMINED';

    if (primaryIntent === 'OTHER') {
      ambiguities.push({
        code: 'INSUFFICIENT_INFORMATION',
        description: 'El fallback local no encontró señales inequívocas.',
        candidateValues: [],
      });
    }

    const extraction: IpdeMessageExtraction = {
      schemaVersion: 1,
      primaryIntent,
      secondaryIntents: detectedIntents.filter(
        (intent) => intent !== primaryIntent,
      ),
      requestPath,
      subjects: [],
      topicSelections,
      productSelections,
      issuerPreference,
      fullNameCandidate,
      requestedArtifacts,
      commercialSignals: {
        asksForPrice,
        asksForDiscount,
        appearsReadyToBuy:
          /\b(quiero comprar|quiero pagar|inscribir|matricular)\b/.test(text),
        wantsHuman,
        mentionsPaymentProof,
      },
      confirmation: confirms
        ? 'CONFIRMS'
        : corrects
          ? 'REJECTS_OR_CORRECTS'
          : 'UNCLEAR',
      needsClarification: ambiguities.length > 0 || primaryIntent === 'OTHER',
      ambiguities,
      overallConfidence: primaryIntent === 'OTHER' ? 0.2 : 0.72,
    };

    return IpdeMessageExtractionSchema.parse(extraction);
  }

  private addIntent(intents: Intent[], intent: Intent): void {
    if (!intents.includes(intent)) intents.push(intent);
  }

  private selectPrimaryIntent(intents: Intent[]): Intent {
    const priority: Intent[] = [
      'REQUEST_HUMAN',
      'PAYMENT_PROOF_MENTION',
      'CORRECT_OR_REJECT',
      'CONFIRM',
      'REQUEST_DISCOUNT',
      'REQUEST_PRICE',
      'REQUEST_PAYMENT_METHODS',
      'REQUEST_MODEL_PDF',
      'REQUEST_PROMOTION',
      'PROVIDE_TOPIC_SELECTION',
      'PROVIDE_FULL_NAME',
      'PROVIDE_ISSUER_PREFERENCE',
      'PROVIDE_PRODUCT_TYPE',
      'REQUEST_SUBJECT_LIST',
      'GREETING',
    ];
    return priority.find((intent) => intents.includes(intent)) ?? 'OTHER';
  }

  private extractProducts(
    rawText: string,
  ): IpdeMessageExtraction['productSelections'] {
    const text = normalizeCatalogText(rawText);
    const matches: Array<{ pattern: RegExp; code: ProductType }> = [
      { pattern: /\bcurso de capacitacion\b/, code: 'CURSO_CAPACITACION' },
      { pattern: /\bcurso de actualizacion\b/, code: 'CURSO_ACTUALIZACION' },
      {
        pattern: /\bcurso de especializacion\b/,
        code: 'CURSO_ESPECIALIZACION',
      },
      { pattern: /\bespecializacion\b/, code: 'ESPECIALIZACION' },
      { pattern: /\bdiplomados?\b/, code: 'DIPLOMADO' },
    ];
    const found = new Set<ProductType>();
    for (const match of matches) {
      if (match.pattern.test(text)) found.add(match.code);
    }
    if (
      /\bcursos?\b/.test(text) &&
      ![...found].some((code) => code.startsWith('CURSO_'))
    ) {
      found.add('CURSO');
    }
    return [...found].map((productTypeCode) => ({
      rawText,
      productTypeCode,
      appliesTo: 'ALL' as const,
      targetReference: null,
      confidence: 0.9,
    }));
  }

  private extractNumericSelections(
    input: IpdeMessageUnderstandingInput,
    ambiguities: Ambiguity[],
  ): TopicSelection[] {
    const numericValues = this.extractNumbers(input.userMessage);
    if (numericValues.length === 0) return [];
    const lists = input.presentedTopicLists ?? [];
    if (lists.length === 0) {
      ambiguities.push({
        code: 'AMBIGUOUS_TOPIC_SELECTION',
        description:
          'Se mencionaron números sin una lista de temas presentada.',
        candidateValues: numericValues.map(String),
      });
      return [];
    }

    const normalizedMessage = normalizeCatalogText(input.userMessage);
    const references = lists
      .map((list) => {
        const full = normalizeCatalogText(list.subjectDisplayName);
        const short = full.split(' ').at(-1) ?? full;
        const fullIndex = normalizedMessage.indexOf(full);
        const shortIndex = normalizedMessage.indexOf(short);
        return {
          list,
          index: fullIndex >= 0 ? fullIndex : shortIndex,
        };
      })
      .filter((reference) => reference.index >= 0)
      .sort((left, right) => left.index - right.index);

    if (references.length === 0 && lists.length === 1) {
      references.push({ list: lists[0], index: 0 });
    }
    if (references.length === 0) {
      ambiguities.push({
        code: 'AMBIGUOUS_TOPIC_SELECTION',
        description: 'No se pudo asociar la selección numérica a una materia.',
        candidateValues: numericValues.map(String),
      });
      return [];
    }

    return references.flatMap((reference, index) => {
      const end = references[index + 1]?.index ?? normalizedMessage.length;
      const segment = normalizedMessage.slice(reference.index, end);
      const numbers = this.extractNumbers(segment).filter((position) =>
        reference.list.topics.some((topic) => topic.position === position),
      );
      return numbers.length > 0
        ? [
            {
              rawText: segment,
              subjectReference: reference.list.subjectDisplayName,
              selectedNumbers: [...new Set(numbers)],
              selectedNames: [],
              confidence: 0.85,
            },
          ]
        : [];
    });
  }

  private extractNumbers(value: string): number[] {
    return [
      ...normalizeCatalogText(value).matchAll(/\b(?:[1-9]|1\d|2[0-5])\b/g),
    ].map((match) => Number(match[0]));
  }

  private extractFullName(
    input: IpdeMessageUnderstandingInput,
    ambiguities: Ambiguity[],
  ): string | null {
    const explicit = input.userMessage.match(
      /(?:soy|mi nombre es|me llamo)\s+([\p{L}]+(?:\s+[\p{L}]+){1,5})/iu,
    )?.[1];
    const inNameStage =
      input.currentStage === IpdeConversationStage.WAITING_FOR_FULL_NAME;
    const bare = inNameStage ? input.userMessage.trim() : null;
    const candidate = (explicit ?? bare)?.replace(/\s+/g, ' ').trim();
    if (!candidate || !/^[\p{L}]+(?:\s+[\p{L}]+){1,5}$/u.test(candidate)) {
      return null;
    }

    const knownName = input.knownOrderContext?.fullName;
    const correction =
      /\b(corrijo|correccion|mi nombre correcto|cambiar)\b/.test(
        normalizeCatalogText(input.userMessage),
      );
    if (
      knownName &&
      normalizeCatalogText(knownName) !== normalizeCatalogText(candidate) &&
      !correction
    ) {
      ambiguities.push({
        code: 'POSSIBLE_NAME_WITHOUT_CONTEXT',
        description: 'Existe un nombre conocido y no se indicó una corrección.',
        candidateValues: [candidate],
      });
      return null;
    }
    return candidate;
  }

  private extractIssuerPreference(
    text: string,
  ): IpdeMessageExtraction['issuerPreference'] {
    if (/\b(cac|colegio de abogados(?: del callao)?)\b/.test(text)) {
      return {
        issuerCode: 'CAC',
        variantCode: 'CAC_DECANO',
        confidence: 0.9,
      };
    }
    if (/\b(posgrado|unidad de posgrado)\b/.test(text)) {
      return {
        issuerCode: 'UNT',
        variantCode: 'UNT_POSGRADO',
        confidence: 0.9,
      };
    }
    if (/\b(resolucion directoral|directoral)\b/.test(text)) {
      return {
        issuerCode: 'UNT',
        variantCode: 'UNT_DIRECTORAL',
        confidence: 0.9,
      };
    }
    if (/\bunt\b/.test(text)) {
      return {
        issuerCode: 'UNT',
        variantCode: 'UNSPECIFIED',
        confidence: 0.65,
      };
    }
    return {
      issuerCode: 'UNSPECIFIED',
      variantCode: 'UNSPECIFIED',
      confidence: 0,
    };
  }
}
