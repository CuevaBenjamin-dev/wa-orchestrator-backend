import { ConfigService } from '@nestjs/config';
import { SubjectCatalogEntry } from '../../catalog/domain/catalog.types';
import { IpdeOutboundActionSchema } from './ipde-conversation-action.schemas';
import { IpdeResponseCopyService } from './ipde-response-copy.service';

function entry(): SubjectCatalogEntry {
  return {
    schemaVersion: 1,
    id: 'DERECHO_CIVIL',
    tenantCode: 'IPDE',
    category: 'DERECHO',
    displayName: 'Derecho Civil',
    normalizedName: 'derecho civil',
    aliases: [],
    allowedProductTypes: ['DIPLOMADO', 'CURSO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `CIVIL_${index + 1}`,
      name: `Tema civil ${index + 1} con una descripción suficientemente clara`,
      aliases: [],
      active: true,
      priority: index + 1,
    })),
    source: 'MANUAL',
    active: true,
    version: 1,
  };
}

describe('IpdeResponseCopyService', () => {
  it('builds validated deterministic topic chunks without splitting topics', () => {
    const service = new IpdeResponseCopyService(
      new ConfigService({ IPDE_WHATSAPP_TEXT_CHUNK_MAX_CHARS: '500' }),
    );
    const first = service.presentTopicList(entry());
    const second = service.presentTopicList(entry());
    expect(first).toEqual(second);
    const parsed = IpdeOutboundActionSchema.parse(first);
    expect(parsed.type).toBe('PRESENT_TOPIC_LIST');
    if (parsed.type !== 'PRESENT_TOPIC_LIST') return;
    expect(parsed.topics).toHaveLength(25);
    expect(parsed.chunks.every((chunk) => chunk.text.length <= 500)).toBe(true);
    expect(parsed.chunks[0].text).toContain('Derecho Civil');
    expect(parsed.chunks.at(-1)?.text).toContain('Respóndeme con los números');
    for (const topic of parsed.topics) {
      expect(parsed.messageDraft).toContain(
        `${topic.position}. ${topic.topicName}`,
      );
    }
  });

  it('falls back to 3000 when chunk configuration is unsafe', () => {
    const service = new IpdeResponseCopyService(
      new ConfigService({ IPDE_WHATSAPP_TEXT_CHUNK_MAX_CHARS: '4500' }),
    );
    const action = service.presentTopicList(entry());
    expect(action.type).toBe('PRESENT_TOPIC_LIST');
    if (action.type === 'PRESENT_TOPIC_LIST') {
      expect(action.chunks.every((chunk) => chunk.text.length <= 3000)).toBe(
        true,
      );
    }
  });

  it('never invents issuer institutions in the pending configuration copy', () => {
    const service = new IpdeResponseCopyService(new ConfigService());
    const action = service.askIssuerVariant();
    expect(action.type).toBe('ASK_ISSUER_VARIANT');
    expect(JSON.stringify(action)).not.toMatch(
      /universidad|colegio|resoluci[oó]n/i,
    );
  });
});
