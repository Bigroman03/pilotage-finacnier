import { describe, expect, it } from 'vitest';
import { calculateBfr } from '../analytics.js';

describe('indicateurs financiers', () => {
  it('calcule le BFR simplifié', () => {
    expect(calculateBfr({
      receivablesCents: 500000,
      inventoryCents: 100000,
      supplierDebtsCents: 250000,
    })).toBe(350000);
  });

  it('autorise un BFR négatif', () => {
    expect(calculateBfr({
      receivablesCents: 100000,
      inventoryCents: 0,
      supplierDebtsCents: 200000,
    })).toBe(-100000);
  });
});

