import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getDashboardTrend, resolveDashboardPeriod } from '../dashboard.js';

describe('périodes de la vue d’ensemble', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');

  it('produit une vue journalière sur trente jours', () => {
    expect(resolveDashboardPeriod('day', undefined, undefined, now)).toMatchObject({
      bucket: 'day', from: '2026-07-23', to: '2026-08-21',
    });
  });

  it('adapte automatiquement une plage personnalisée longue au mois', () => {
    expect(resolveDashboardPeriod('custom', '2026-01-01', '2026-08-21', now).bucket).toBe('month');
  });

  it('refuse une plage inversée', () => {
    expect(() => resolveDashboardPeriod('custom', '2026-08-21', '2026-08-01', now)).toThrow('postérieure');
  });

  it('sépare le CA HT Stripe des encaissements Qonto', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE transactions(date TEXT, side TEXT, amount_cents INTEGER, status TEXT, currency TEXT);
      CREATE TABLE stripe_invoices(paid_at TEXT, amount_ht_cents INTEGER, currency TEXT);
      INSERT INTO transactions VALUES ('2026-08-10T10:00:00.000Z', 'credit', 12000, 'completed', 'EUR');
      INSERT INTO transactions VALUES ('2026-08-10T11:00:00.000Z', 'debit', 3000, 'completed', 'EUR');
      INSERT INTO stripe_invoices VALUES ('2026-08-10T09:00:00.000Z', 10000, 'EUR');
    `);
    const trend = getDashboardTrend(db, resolveDashboardPeriod('custom', '2026-08-10', '2026-08-10', now));
    expect(trend[0]).toMatchObject({ inflowsCents: 12000, outflowsCents: 3000, revenueHtCents: 10000 });
    db.close();
  });
});
