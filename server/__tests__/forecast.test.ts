import { describe, expect, it } from 'vitest';
import { buildForecast, plannedAmountExcludingTax } from '../analytics.js';
import type { PlannedExpense, RecurringVendor } from '../../shared/types.js';

const recurring: RecurringVendor[] = [{
  vendor: 'CANVA', category: 'Logiciels & abonnements', subcategory: 'Création & design',
  estimatedMonthlyCents: 1500, averageTransactionCents: 1500, occurrences: 6, activeMonths: 6,
  lastSeenAt: '2026-08-10T00:00:00.000Z', confidence: 'high',
}];

const plan = (overrides: Partial<PlannedExpense>): PlannedExpense => ({
  id: 1, label: 'Dépense', vendor: 'Fournisseur', amountCents: 10000,
  enteredAmountCents: 10000, taxMode: 'ht', vatRateBasisPoints: 2000,
  category: 'Autres dépenses', subcategory: 'Prévision', kind: 'one_off',
  startDate: '2026-09-15', endDate: null, notes: null, active: true,
  createdAt: '2026-08-21', updatedAt: '2026-08-21', ...overrides,
});

describe('prévisionnel', () => {
  it('ajoute une dépense unique seulement sur son mois', () => {
    const result = buildForecast({ start: new Date(2026, 7, 21), months: 3, cashBalanceCents: 100000,
      stripeMrrCents: 20000, recurringVendors: recurring, plannedExpenses: [plan({})] });
    expect(result[0].plannedOneOffCents).toBe(0);
    expect(result[1].plannedOneOffCents).toBe(10000);
    expect(result[2].plannedOneOffCents).toBe(0);
  });

  it('applique une dépense mensuelle à partir de sa date de début', () => {
    const result = buildForecast({ start: new Date(2026, 7, 21), months: 3, cashBalanceCents: 100000,
      stripeMrrCents: 20000, recurringVendors: [], plannedExpenses: [plan({ kind: 'monthly', startDate: '2026-09-01', amountCents: 5000 })] });
    expect(result.map((month) => month.plannedMonthlyCents)).toEqual([0, 5000, 5000]);
  });

  it('applique une dépense trimestrielle tous les trois mois', () => {
    const result = buildForecast({ start: new Date(2026, 7, 21), months: 7, cashBalanceCents: 100000,
      stripeMrrCents: 0, recurringVendors: [], plannedExpenses: [plan({ kind: 'quarterly', startDate: '2026-09-01', amountCents: 9000 })] });
    expect(result.map((month) => month.plannedQuarterlyCents)).toEqual([0, 9000, 0, 0, 9000, 0, 0]);
  });

  it('applique une dépense annuelle uniquement au mois anniversaire', () => {
    const result = buildForecast({ start: new Date(2026, 7, 21), months: 14, cashBalanceCents: 100000,
      stripeMrrCents: 0, recurringVendors: [], plannedExpenses: [plan({ kind: 'yearly', startDate: '2026-09-15', amountCents: 12000 })] });
    expect(result.map((month) => month.plannedYearlyCents)).toEqual([0, 12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12000]);
  });

  it('inclut les abonnements Qonto dans chaque mois', () => {
    const result = buildForecast({ start: new Date(2026, 7, 21), months: 2, cashBalanceCents: 100000,
      stripeMrrCents: 20000, recurringVendors: recurring, plannedExpenses: [] });
    expect(result.every((month) => month.recurringQontoCents === 1500)).toBe(true);
    expect(result[0].projectedBalanceCents).toBe(118500);
  });

  it('convertit un montant TTC à 20 % en HT', () => {
    expect(plannedAmountExcludingTax(12000, 'ttc', 2000)).toBe(10000);
  });

  it('conserve en HT un coût soumis à autoliquidation', () => {
    expect(plannedAmountExcludingTax(10000, 'reverse_charge', 2000)).toBe(10000);
  });
});
