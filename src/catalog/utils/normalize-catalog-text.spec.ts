import { normalizeCatalogText } from './normalize-catalog-text';

describe('normalizeCatalogText', () => {
  it.each([
    ['Derecho Procesal Civil', 'derecho procesal civil'],
    ['  Educación   Inicial ', 'educacion inicial'],
    ['IVA', 'iva'],
    ['Gestión Pública: Nivel 2', 'gestion publica nivel 2'],
  ])('normalizes %p deterministically', (input, expected) => {
    expect(normalizeCatalogText(input)).toBe(expected);
    expect(normalizeCatalogText(input)).toBe(expected);
  });
});
