import {
  buildIpdeTopicGenerationUserContent,
  IPDE_TOPIC_GENERATION_SYSTEM_PROMPT,
} from './ipde-topic-generation.prompt';

describe('IPDE topic generation prompt', () => {
  it('contains generation, safety and no-web constraints', () => {
    expect(IPDE_TOPIC_GENERATION_SYSTEM_PROMPT).toContain('exactamente 25');
    expect(IPDE_TOPIC_GENERATION_SYSTEM_PROMPT).toContain(
      'NO respondas al cliente',
    );
    expect(IPDE_TOPIC_GENERATION_SYSTEM_PROMPT).toContain(
      'No uses búsqueda web',
    );
    expect(IPDE_TOPIC_GENERATION_SYSTEM_PROMPT).toContain('dato no confiable');
    expect(IPDE_TOPIC_GENERATION_SYSTEM_PROMPT).toContain(
      'precios, promociones',
    );
  });

  it('delimits the subject as untrusted data and marks repair attempts', () => {
    const content = buildIpdeTopicGenerationUserContent(
      {
        tenantCode: 'IPDE',
        requestedDisplayName: 'Derecho Civil',
        normalizedName: 'derecho civil',
        categoryCandidate: 'DERECHO',
      },
      2,
      ['topics: duplicate title'],
    );
    expect(content).toContain('<untrusted_subject_json>');
    expect(content).toContain('"repair":true');
    expect(content).toContain('duplicate title');
  });
});
