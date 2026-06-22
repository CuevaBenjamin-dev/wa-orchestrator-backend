import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiService } from './ai.service';
import { OpenAiClientService } from './openai-client.service';

function createAiService(params?: {
  configured?: boolean;
  parseResult?: unknown;
  createResult?: unknown;
}) {
  const parse = jest.fn<(request: unknown) => Promise<unknown>>();
  const create = jest.fn<(request: unknown) => Promise<unknown>>();
  if (params?.parseResult !== undefined) {
    parse.mockResolvedValue(params.parseResult);
  }
  if (params?.createResult !== undefined) {
    create.mockResolvedValue(params.createResult);
  }
  const client = { responses: { parse, create } } as unknown as OpenAI;
  const clientService = {
    getClient: () => (params?.configured === false ? null : client),
  } as OpenAiClientService;
  return {
    parse,
    create,
    service: new AiService(new ConfigService({}), clientService),
  };
}

describe('AiService shared-client regression', () => {
  it('preserves local classification without an API key', async () => {
    const { service } = createAiService({ configured: false });

    const result = await service.classifyUserIntent({
      tenantName: 'Negocio ficticio',
      businessType: 'EDUCACION',
      userMessage: '¿Cuál es el precio?',
    });

    expect(result).toMatchObject({
      intent: 'PRECIO',
      shouldUsePredefinedResponse: true,
      requiresHuman: false,
    });
  });

  it('preserves the simulated reply without an API key', async () => {
    const { service } = createAiService({ configured: false });

    const result = await service.generateAgentReply({
      tenantName: 'Negocio ficticio',
      businessType: 'EDUCACION',
      userMessage: 'Hola',
      recentMessages: [],
    });

    expect(result.text).toContain('Negocio ficticio');
    expect(result.tokensInput).toBe(0);
    expect(result.tokensOutput).toBe(0);
  });

  it('preserves models, parsed classification and generated reply usage', async () => {
    const { service, parse, create } = createAiService({
      parseResult: {
        output_parsed: {
          intent: 'SALUDO',
          confidence: 0.9,
          shouldUsePredefinedResponse: true,
          shouldUseRag: false,
          requiresHuman: false,
          reason: 'Saludo simple',
        },
      },
      createResult: {
        output_text: 'Hola, ¿cómo puedo ayudarte?',
        usage: { input_tokens: 25, output_tokens: 8 },
      },
    });

    const classification = await service.classifyUserIntent({
      tenantName: 'Negocio ficticio',
      businessType: 'EDUCACION',
      userMessage: 'Hola',
    });
    const reply = await service.generateAgentReply({
      tenantName: 'Negocio ficticio',
      businessType: 'EDUCACION',
      userMessage: 'Hola',
      recentMessages: [],
    });

    expect(classification.intent).toBe('SALUDO');
    expect(reply).toEqual({
      text: 'Hola, ¿cómo puedo ayudarte?',
      tokensInput: 25,
      tokensOutput: 8,
    });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4-mini' }),
    );
  });
});
