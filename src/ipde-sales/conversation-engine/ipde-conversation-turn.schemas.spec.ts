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
});
