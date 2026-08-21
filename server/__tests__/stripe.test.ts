import { describe, expect, it } from 'vitest';
import { amountExcludingTax, countsTowardMrr } from '../stripe.js';

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
});
