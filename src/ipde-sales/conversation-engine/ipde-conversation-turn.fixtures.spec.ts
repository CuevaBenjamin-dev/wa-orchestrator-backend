import cases from './fixtures/ipde-conversation-turn-cases.json';

describe('IPDE conversation turn fixtures', () => {
  it('keeps at least fifteen unique scenarios', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it.each(cases)('$id has a bounded message and expected action', (item) => {
    expect(item.message.length).toBeGreaterThan(0);
    expect(item.message.length).toBeLessThanOrEqual(4000);
    expect(item.expectedAction).toMatch(/^[A-Z_]+$/);
    expect(typeof item.createsOrder).toBe('boolean');
  });
});
