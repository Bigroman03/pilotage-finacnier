import Stripe from 'stripe';
import type Database from 'better-sqlite3';

export const isStripeConfigured = () => Boolean(process.env.STRIPE_RESTRICTED_KEY?.trim());

const monthlyAmount = (amount: number, interval: Stripe.Price.Recurring.Interval, intervalCount: number) => {
  const count = Math.max(1, intervalCount || 1);
  if (interval === 'day') return amount * 30 / count;
  if (interval === 'week') return amount * 4.345 / count;
  if (interval === 'year') return amount / (12 * count);
  return amount / count;
};

export const syncStripe = async (db: Database.Database) => {
  const key = process.env.STRIPE_RESTRICTED_KEY?.trim();
  if (!key) throw new Error('Connexion Stripe non configurée.');
  const startedAt = new Date().toISOString();
  const run = db.prepare("INSERT INTO sync_runs(source, status, started_at) VALUES ('stripe', 'running', ?)").run(startedAt);

  try {
    const stripe = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });
    let mrrCents = 0;
    let activeSubscriptions = 0;
    let currency = 'EUR';

    for await (const subscription of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
      if (!['active', 'trialing'].includes(subscription.status)) continue;
      activeSubscriptions += 1;
      for (const item of subscription.items.data) {
        const price = item.price;
        if (!price.recurring || price.unit_amount === null) continue;
        currency = price.currency.toUpperCase();
        mrrCents += monthlyAmount(price.unit_amount * (item.quantity || 1), price.recurring.interval, price.recurring.interval_count);
      }
    }

    const syncedAt = new Date().toISOString();
    const roundedMrr = Math.round(mrrCents);
    db.prepare(`INSERT INTO stripe_metrics(id, mrr_cents, arr_cents, active_subscriptions, currency, synced_at)
      VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mrr_cents=excluded.mrr_cents,
      arr_cents=excluded.arr_cents, active_subscriptions=excluded.active_subscriptions, currency=excluded.currency, synced_at=excluded.synced_at`)
      .run(roundedMrr, roundedMrr * 12, activeSubscriptions, currency, syncedAt);
    db.prepare("UPDATE sync_runs SET status='success', completed_at=?, imported_count=?, message=? WHERE id=?")
      .run(syncedAt, activeSubscriptions, 'Clé Stripe restreinte · lecture seule', run.lastInsertRowid);
    return { mrrCents: roundedMrr, activeSubscriptions, currency };
  } catch (error) {
    db.prepare("UPDATE sync_runs SET status='error', completed_at=?, message=? WHERE id=?")
      .run(new Date().toISOString(), error instanceof Error ? error.message : 'Erreur inconnue', run.lastInsertRowid);
    throw error;
  }
};

