import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

describe('IPDE catalog resolution fixtures', () => {
  it('contains fictitious generation and numeric regression cases', () => {
    const generation = z
      .array(z.record(z.string(), z.unknown()))
      .min(8)
      .parse(
        JSON.parse(
          readFileSync(
            join(__dirname, 'fixtures', 'ipde-topic-generation-cases.json'),
            'utf8',
          ),
        ) as unknown,
      );
    const numeric = z
      .array(z.record(z.string(), z.unknown()))
      .min(4)
      .parse(
        JSON.parse(
          readFileSync(
            join(__dirname, 'fixtures', 'ipde-numeric-selection-cases.json'),
            'utf8',
          ),
        ) as unknown,
      );

    expect(generation.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'manual-derecho-civil',
        'health-andrology',
        'ambiguous-iva',
        'prompt-injection',
      ]),
    );
    expect(numeric.map((item) => item.id)).toContain(
      'civil-two-seven-penal-three',
    );
  });
});
