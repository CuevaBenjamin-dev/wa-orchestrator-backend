import cases from './fixtures/ipde-commercial-config-cases.json';

describe('IPDE commercial configuration fixtures', () => {
  it('keeps the required fictitious scenarios unique', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((item) => item.id))).toHaveProperty(
      'size',
      cases.length,
    );
  });
});
