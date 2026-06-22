import {
  GeneratedTopicListSchema,
  GenerateIpdeSubjectEntryInputSchema,
} from './ipde-topic-generation.schemas';

const WORDS = [
  'Alfa',
  'Beta',
  'Gamma',
  'Delta',
  'Épsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
  'Lambda',
  'Mu',
  'Nu',
  'Xi',
  'Ómicron',
  'Pi',
  'Rho',
  'Sigma',
  'Tau',
  'Ípsilon',
  'Phi',
  'Chi',
  'Psi',
  'Omega',
  'Final',
];

function validList() {
  return {
    schemaVersion: 1 as const,
    subjectDisplayName: 'Materia Ficticia',
    topics: WORDS.map((word) => ({
      name: `Contenido académico ${word}`,
      aliases: [],
    })),
  };
}

describe('GeneratedTopicListSchema', () => {
  it('accepts exactly 25 distinct safe titles', () => {
    expect(GeneratedTopicListSchema.safeParse(validList()).success).toBe(true);
  });

  it.each([24, 26])('rejects a list with %s topics', (length) => {
    const list = validList();
    list.topics = Array.from({ length }, (_, index) => ({
      name: `Contenido académico ${String.fromCharCode(65 + index)}`,
      aliases: [],
    }));
    expect(GeneratedTopicListSchema.safeParse(list).success).toBe(false);
  });

  it('rejects duplicate normalized names', () => {
    const list = validList();
    list.topics[24].name = '  Contenido académico ÁLFA ';
    expect(GeneratedTopicListSchema.safeParse(list).success).toBe(false);
  });

  it.each([
    '1. Contratos civiles',
    'Tema 1',
    'Programa de Universidad Nacional',
    'Resolución oficial para certificación',
    'Precio promocional especial',
    'Contenido con firma y sello',
    'Contenido académico 😀',
  ])('rejects unsafe title %p', (name) => {
    const list = validList();
    list.topics[0].name = name;
    expect(GeneratedTopicListSchema.safeParse(list).success).toBe(false);
  });

  it('rejects extra properties', () => {
    const list = {
      ...validList(),
      description: 'No permitida',
    };
    expect(GeneratedTopicListSchema.safeParse(list).success).toBe(false);
  });
});

describe('GenerateIpdeSubjectEntryInputSchema', () => {
  it('requires the official normalized subject name', () => {
    expect(() =>
      GenerateIpdeSubjectEntryInputSchema.parse({
        tenantCode: 'IPDE',
        requestedDisplayName: 'Educación Inicial',
        normalizedName: 'educacion-inicial',
        categoryCandidate: 'EDUCACION',
      }),
    ).toThrow();
  });
});
