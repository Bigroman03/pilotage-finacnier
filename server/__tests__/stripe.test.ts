import { describe, expect, it } from 'vitest';
import { amountExcludingTax, countsTowardMrr, invoiceAmountExcludingTax, monthlyAmount } from '../stripe.js';

describe('MRR Stripe HT', () => {
  it('conserve un prix hors taxe', () => {
    expect(amountExcludingTax(10000, 'exclusive', [{ inclusive: false, percentage: 20 }])).toBe(10000);
  });

  it('retire la TVA d’un prix taxes incluses', () => {
    expect(Math.round(amountExcludingTax(12000, 'inclusive', [{ inclusive: true, percentage: 20 }]))).toBe(10000);
  });

  it('ne devine pas une taxe inclusive absente', () => {
    expect(amountExcludingTax(10000, 'inclusive', [])).toBe(10000);
  });

  it('exclut les essais gratuits du MRR', () => {
    expect(countsTowardMrr('active')).toBe(true);
    expect(countsTowardMrr('trialing')).toBe(false);
  });

  it('normalise une offre annuelle au mois', () => {
    expect(monthlyAmount(120000, 'year', 1)).toBe(10000);
  });

  it('utilise le total de facture HT fourni par Stripe', () => {
    expect(invoiceAmountExcludingTax({
      total_excluding_tax: 10000,
      subtotal_excluding_tax: 11000,
      total: 12000,
      total_taxes: [{ amount: 2000 }] as never,
    })).toBe(10000);
  });

  it('retire les taxes du total lorsque le total HT historique est absent', () => {
    expect(invoiceAmountExcludingTax({
      total_excluding_tax: null,
      subtotal_excluding_tax: null,
      total: 12000,
      total_taxes: [{ amount: 2000 }] as never,
    })).toBe(10000);
  });
});
