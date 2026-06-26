import { ConfigService } from '@nestjs/config';
import { MessageRole } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { ConversationsService } from '../conversations/conversations.service';
import { IpdeWhatsappOrchestratorService } from '../ipde-sales/whatsapp/ipde-whatsapp-orchestrator.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadsService } from '../leads/leads.service';
import { RulesService } from '../rules/rules.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsageService } from '../usage/usage.service';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  afterEach(() => {
    fetchMock?.mockRestore();
  });

  it('delegates IPDE text messages to the IPDE webhook orchestrator', async () => {
    const harness = createHarness({ ipdeCanHandle: true });

    const result = await harness.service.handleIncomingWebhook(
      webhookPayload(textMessage()),
    );

    expect(result).toEqual({
      processed: 1,
      results: [
        {
          status: 'ipde_text_processed',
          tenantId: 'tenant-1',
          leadId: 'lead-1',
          conversationId: 'conversation-1',
          from: '51999999999',
        },
      ],
    });
    expect(harness.ipdeWhatsapp.handleIncomingMessage).toHaveBeenCalledWith({
      tenant: tenant(),
      phoneNumberId: 'ipde-phone-id',
      message: textMessage(),
      contacts: contacts(),
    });
    expect(harness.leads.findOrCreateLead).not.toHaveBeenCalled();
    expect(harness.rules.evaluateMessage).not.toHaveBeenCalled();
    expect(harness.ai.classifyUserIntent).not.toHaveBeenCalled();
  });

  it('delegates IPDE media before the legacy non-text ignore branch', async () => {
    const harness = createHarness({
      ipdeCanHandle: true,
      ipdeResult: {
        status: 'ipde_media_ignored',
        tenantId: 'tenant-1',
        reason: 'MEDIA_NOT_PAYMENT_PROOF',
      },
    });

    await expect(
      harness.service.handleIncomingWebhook(webhookPayload(imageMessage())),
    ).resolves.toEqual({
      processed: 1,
      results: [
        {
          status: 'ipde_media_ignored',
          tenantId: 'tenant-1',
          reason: 'MEDIA_NOT_PAYMENT_PROOF',
        },
      ],
    });
    expect(harness.ipdeWhatsapp.handleIncomingMessage).toHaveBeenCalled();
    expect(harness.leads.findOrCreateLead).not.toHaveBeenCalled();
  });

  it('keeps the existing non-IPDE text flow intact without real WhatsApp sending', async () => {
    fetchMock = jest.spyOn(global, 'fetch');
    const harness = createHarness({ ipdeCanHandle: false });

    const result = await harness.service.handleIncomingWebhook(
      webhookPayload(textMessage()),
    );

    expect(result.results[0]).toMatchObject({
      status: 'message_processed',
      tenantId: 'tenant-1',
      userMessage: 'Hola',
      agentReply: 'Respuesta por regla',
      responseSource: 'RULE',
    });
    expect(harness.ipdeWhatsapp.handleIncomingMessage).not.toHaveBeenCalled();
    expect(harness.leads.findOrCreateLead).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      phone: '51999999999',
      name: 'Benja',
    });
    expect(harness.conversations.addMessage).toHaveBeenNthCalledWith(1, {
      conversationId: 'conversation-1',
      role: MessageRole.USER,
      content: 'Hola',
      externalId: 'wamid.text-1',
    });
    expect(harness.conversations.addMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: MessageRole.ASSISTANT,
        content: 'Respuesta por regla',
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores duplicated WhatsApp messages before IPDE or legacy processing', async () => {
    const harness = createHarness({
      ipdeCanHandle: true,
      existingExternalMessage: { id: 'existing-message' },
    });

    await expect(
      harness.service.handleIncomingWebhook(webhookPayload(textMessage())),
    ).resolves.toEqual({
      processed: 1,
      results: [
        {
          status: 'duplicated_message_ignored',
          externalId: 'wamid.text-1',
        },
      ],
    });
    expect(harness.ipdeWhatsapp.canHandleTenant).not.toHaveBeenCalled();
    expect(harness.ipdeWhatsapp.handleIncomingMessage).not.toHaveBeenCalled();
    expect(harness.leads.findOrCreateLead).not.toHaveBeenCalled();
  });
});

interface HarnessOptions {
  ipdeCanHandle: boolean;
  existingExternalMessage?: unknown;
  ipdeResult?: unknown;
}

function createHarness(options: HarnessOptions) {
  const tenants = {
    findByWhatsappPhoneId: jest.fn().mockResolvedValue(tenant()),
  };
  const leads = {
    findOrCreateLead: jest.fn().mockResolvedValue({ id: 'lead-1' }),
  };
  const conversations = {
    findByExternalId: jest
      .fn()
      .mockResolvedValue(options.existingExternalMessage ?? null),
    findOrCreateConversation: jest
      .fn()
      .mockResolvedValue({ id: 'conversation-1' }),
    addMessage: jest.fn().mockResolvedValue({ id: 'message-1' }),
    getRecentMessages: jest.fn().mockResolvedValue([]),
  };
  const usage = {
    incrementInboundMessage: jest.fn().mockResolvedValue(undefined),
    incrementAiUsage: jest.fn().mockResolvedValue(undefined),
  };
  const rules = {
    evaluateMessage: jest.fn().mockResolvedValue({
      answeredByRule: true,
      reply: 'Respuesta por regla',
      reason: 'MATCHED_RULE',
      requiresHuman: false,
    }),
    findPredefinedResponseByIntent: jest.fn(),
  };
  const ai = {
    classifyUserIntent: jest.fn(),
    generateAgentReply: jest.fn(),
  };
  const knowledge = {
    searchRelevantKnowledgeItems: jest.fn(),
    buildKnowledgeContext: jest.fn(),
  };
  const ipdeWhatsapp = {
    canHandleTenant: jest.fn().mockReturnValue(options.ipdeCanHandle),
    handleIncomingMessage: jest.fn().mockResolvedValue(
      options.ipdeResult ?? {
        status: 'ipde_text_processed',
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        conversationId: 'conversation-1',
        from: '51999999999',
      },
    ),
  };
  const service = new WhatsappService(
    new ConfigService({ WHATSAPP_SEND_ENABLED: 'false' }),
    tenants as unknown as TenantsService,
    leads as unknown as LeadsService,
    conversations as unknown as ConversationsService,
    usage as unknown as UsageService,
    rules as unknown as RulesService,
    ai as unknown as AiService,
    knowledge as unknown as KnowledgeService,
    ipdeWhatsapp as unknown as IpdeWhatsappOrchestratorService,
  );

  return {
    service,
    tenants,
    leads,
    conversations,
    usage,
    rules,
    ai,
    knowledge,
    ipdeWhatsapp,
  };
}

function webhookPayload(message: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: 'ipde-phone-id' },
              contacts: contacts(),
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function textMessage() {
  return {
    id: 'wamid.text-1',
    from: '51999999999',
    type: 'text',
    text: { body: 'Hola' },
  };
}

function imageMessage() {
  return {
    id: 'wamid.image-1',
    from: '51999999999',
    type: 'image',
    image: { id: 'media-image-1', mime_type: 'image/jpeg' },
  };
}

function contacts() {
  return [{ wa_id: '51999999999', profile: { name: 'Benja' } }];
}

function tenant() {
  return {
    id: 'tenant-1',
    name: 'Tenant Genérico',
    businessType: 'education',
    whatsappPhoneId: 'ipde-phone-id',
    status: 'ACTIVE',
  };
}
