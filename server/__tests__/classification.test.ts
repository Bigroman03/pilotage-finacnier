import { describe, expect, it } from 'vitest';
import { classifyExpense, normalizeVendor } from '../classification.js';

describe('classification des dépenses', () => {
  it('classe un abonnement OpenAI dans les logiciels', () => {
    expect(classifyExpense({ label: 'PRLV OPENAI CHATGPT 2026' })).toEqual({
      category: 'Logiciels & abonnements',
      subcategory: 'IA & productivité',
    });
  });

  it('classe OVH dans l’hébergement', () => {
    expect(classifyExpense({ label: 'CB OVH SAS FRANCE' }).category).toBe('Infrastructure & hébergement');
  });

  it('normalise les libellés bancaires variables', () => {
    expect(normalizeVendor('CB CANVA 12082026 784512')).toBe('CANVA');
  });

  it('conserve la catégorie Qonto quand aucune règle fournisseur ne correspond', () => {
    expect(classifyExpense({ label: 'FOURNISSEUR XYZ', qontoCategory: 'insurance' })).toEqual({
      category: 'Assurances',
      subcategory: 'Assurances professionnelles',
    });
  });
});

