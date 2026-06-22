import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const FixtureSchema = z
  .object({
    id: z.string().min(1),
    message: z.string().min(1),
    context: z.record(z.string(), z.unknown()).optional(),
    expected: z.record(z.string(), z.unknown()),
  })
  .strict();

describe('IPDE understanding evaluation fixtures', () => {
  it('contains valid, fictitious essential regression cases', () => {
    const fixturePath = join(
      __dirname,
      'fixtures',
      'ipde-understanding-cases.json',
    );
    const fixtures = z
      .array(FixtureSchema)
      .min(13)
      .parse(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown);

    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(
      fixtures.length,
    );
    expect(fixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        'subject-civil',
        'multiple-subjects',
        'direct-topics',
        'ambiguous-acronym',
        'numeric-selection',
        'prompt-injection',
      ]),
    );
  });
});
