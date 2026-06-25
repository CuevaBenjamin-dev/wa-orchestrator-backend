import { IpdeOutboundActionSchema } from './ipde-conversation-action.schemas';
import { IpdeConversationTurnInputSchema } from './ipde-conversation-turn.schemas';

describe('IPDE conversation turn schemas', () => {
  const validInput = {
    tenantCode: 'IPDE',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    turnId: 'wamid-1',
    userMessage: 'Hola',
    recentMessages: [],
  } as const;

  it('accepts the strict bounded input contract', () => {
    expect(IpdeConversationTurnInputSchema.parse(validInput)).toEqual(
      validInput,
    );
  });

  it('rejects unknown fields and more than six recent messages', () => {
    expect(() =>
      IpdeConversationTurnInputSchema.parse({ ...validInput, secret: 'no' }),
    ).toThrow();
    expect(() =>
      IpdeConversationTurnInputSchema.parse({
        ...validInput,
        recentMessages: Array.from({ length: 7 }, () => ({
          role: 'USER',
          content: 'x',
        })),
      }),
    ).toThrow();
  });

  it('does not allow a draft in NO_AUTOMATED_RESPONSE', () => {
    expect(() =>
      IpdeOutboundActionSchema.parse({
        type: 'NO_AUTOMATED_RESPONSE',
        reason: 'PAUSED_HUMAN',
        messageDraft: 'No debe existir',
      }),
    ).toThrow();
  });

  it('requires exactly 25 topics in a presented list', () => {
    expect(() =>
      IpdeOutboundActionSchema.parse({
        type: 'PRESENT_TOPIC_LIST',
        subjectCatalogEntryId: 'CIVIL',
        subjectDisplayName: 'Derecho Civil',
        source: 'MANUAL',
        topics: [],
        chunks: [{ sequence: 1, text: 'Lista' }],
        messageDraft: 'Lista',
      }),
    ).toThrow();
  });

  it('accepts pricing actions without exposing the minimum authorized amount', () => {
    const action = IpdeOutboundActionSchema.parse({
      type: 'QUOTE_PRICE',
      currencyCode: 'PEN',
      totalRegularAmount: '120.00',
      totalPromotionalAmount: '80.00',
      promotionLabel: 'Promoción vigente',
      appliedRuleIds: ['PRICE_DERECHO_DIPLOMADO_CAC_DECANO_1'],
      messageDraft:
        'Perfecto. Para la opción seleccionada, el precio promocional total es S/ 80.',
    });
    expect(JSON.stringify(action)).not.toMatch(/minimumAuthorizedAmount/);

    expect(() =>
      IpdeOutboundActionSchema.parse({
        ...action,
        minimumAuthorizedAmount: '70.00',
      }),
    ).toThrow();
  });

  it('accepts strict media outbound actions', () => {
    expect(
      IpdeOutboundActionSchema.parse({
        type: 'SEND_PROMOTION_IMAGE',
        assetId: 'PROMO_DERECHO_GENERAL',
        categoryCode: 'DERECHO',
        messageDraft: 'Claro, te comparto la promoción disponible.',
      }),
    ).toMatchObject({ type: 'SEND_PROMOTION_IMAGE' });

    expect(
      IpdeOutboundActionSchema.parse({
        type: 'SEND_PAYMENT_METHODS_IMAGE',
        assetId: 'PAYMENT_METHODS_GENERAL',
        messageDraft: 'Claro, te envío los medios de pago disponibles.',
      }),
    ).toMatchObject({ type: 'SEND_PAYMENT_METHODS_IMAGE' });
  });
});
