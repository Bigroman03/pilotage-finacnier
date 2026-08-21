import Stripe from 'stripe';
import type Database from 'better-sqlite3';

export const isStripeConfigured = () => Boolean(process.env.STRIPE_RESTRICTED_KEY?.trim());

export const countsTowardMrr = (status: Stripe.Subscription.Status) => status === 'active';

export const monthlyAmount = (amount: number, interval: Stripe.Price.Recurring.Interval, intervalCount: number) => {
  const count = Math.max(1, intervalCount || 1);
  if (interval === 'day') return amount * 30 / count;
  if (interval === 'week') return amount * 4.345 / count;
  if (interval === 'year') return amount / (12 * count);
  return amount / count;
};

export const invoiceAmountExcludingTax = (
  invoice: Pick<Stripe.Invoice, 'total_excluding_tax' | 'subtotal_excluding_tax' | 'total' | 'total_taxes'>,
) => invoice.total_excluding_tax
  ?? invoice.subtotal_excluding_tax
  ?? Math.max(0, invoice.total - (invoice.total_taxes || []).reduce((sum, tax) => sum + tax.amount, 0));

type CustomerAggregate = {
  id: string;
  name: string;
  email: string | null;
  currency: string;
  activeSubscriptionCount: number;
  currentMrrHtCents: number;
  lifetimeSpendHtCents: number;
  paidInvoiceCount: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  offers: Array<{
    subscriptionId: string;
    priceId: string;
    productId: string | null;
    productName: string;
    interval: string;
    intervalCount: number;
    quantity: number;
    monthlyMrrHtCents: number;
  }>;
};

const customerIdentity = (customer: Stripe.Subscription['customer']) => {
  if (typeof customer === 'string') return { id: customer, name: customer, email: null };
  if ('deleted' in customer && customer.deleted) return { id: customer.id, name: 'Client supprimé', email: null };
  return {
    id: customer.id,
    name: customer.business_name || customer.name || customer.individual_name || customer.email || customer.id,
    email: customer.email,
  };
};

const productIdentity = (product: Stripe.Price['product'], price: Stripe.Price) => {
  if (typeof product === 'string') return { id: product, name: price.nickname || product };
  if ('deleted' in product && product.deleted) return { id: product.id, name: price.nickname || 'Offre supprimée' };
  return { id: product.id, name: product.name || price.nickname || product.id };
};

const unixToIso = (value: number | null | undefined) => value ? new Date(value * 1000).toISOString() : null;

export const amountExcludingTax = (
  amountCents: number,
  taxBehavior: Stripe.Price.TaxBehavior | null,
  taxRates: Array<Pick<Stripe.TaxRate, 'inclusive' | 'percentage'>> = [],
) => {
  if (taxBehavior !== 'inclusive') return amountCents;
  const inclusiveRate = taxRates
    .filter((rate) => rate.inclusive)
    .reduce((sum, rate) => sum + rate.percentage, 0);
  return inclusiveRate > 0 ? amountCents / (1 + inclusiveRate / 100) : amountCents;
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
    const customers = new Map<string, CustomerAggregate>();
    const invoices: Array<{ id: string; customerId: string | null; amountHtCents: number; currency: string; paidAt: string }> = [];

    for await (const subscription of stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.customer', 'data.items.data.price.product'],
    })) {
      if (!countsTowardMrr(subscription.status)) continue;
      activeSubscriptions += 1;
      const identity = customerIdentity(subscription.customer);
      const customer = customers.get(identity.id) || {
        ...identity,
        currency: subscription.currency.toUpperCase(),
        activeSubscriptionCount: 0,
        currentMrrHtCents: 0,
        lifetimeSpendHtCents: 0,
        paidInvoiceCount: 0,
        firstPaidAt: null,
        lastPaidAt: null,
        offers: [],
      };
      customer.activeSubscriptionCount += 1;
      for (const item of subscription.items.data) {
        const price = item.price;
        if (!price.recurring || price.unit_amount === null) continue;
        currency = price.currency.toUpperCase();
        const taxRates = item.tax_rates?.length ? item.tax_rates : subscription.default_tax_rates || [];
        const netUnitAmount = amountExcludingTax(price.unit_amount, price.tax_behavior, taxRates);
        const itemMrr = monthlyAmount(netUnitAmount * (item.quantity || 1), price.recurring.interval, price.recurring.interval_count);
        const product = productIdentity(price.product, price);
        mrrCents += itemMrr;
        customer.currentMrrHtCents += itemMrr;
        customer.offers.push({
          subscriptionId: subscription.id,
          priceId: price.id,
          productId: product.id,
          productName: product.name,
          interval: price.recurring.interval,
          intervalCount: price.recurring.interval_count,
          quantity: item.quantity || 1,
          monthlyMrrHtCents: Math.round(itemMrr),
        });
      }
      customers.set(identity.id, customer);
    }

    for await (const invoice of stripe.invoices.list({ status: 'paid', limit: 100 })) {
      const amountHt = invoiceAmountExcludingTax(invoice);
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
      const paidAt = unixToIso(invoice.status_transitions.paid_at) || unixToIso(invoice.created)!;
      invoices.push({ id: invoice.id, customerId, amountHtCents: amountHt, currency: invoice.currency.toUpperCase(), paidAt });
      if (!customerId) continue;
      const customer = customers.get(customerId);
      if (!customer) continue;
      customer.lifetimeSpendHtCents += amountHt;
      customer.paidInvoiceCount += 1;
      if (paidAt && (!customer.firstPaidAt || paidAt < customer.firstPaidAt)) customer.firstPaidAt = paidAt;
      if (paidAt && (!customer.lastPaidAt || paidAt > customer.lastPaidAt)) customer.lastPaidAt = paidAt;
    }

    const syncedAt = new Date().toISOString();
    const roundedMrr = Math.round(mrrCents);
    const replace = db.transaction(() => {
      db.prepare('DELETE FROM stripe_customer_offers').run();
      db.prepare('DELETE FROM stripe_customers').run();
      db.prepare('DELETE FROM stripe_invoices').run();
      const insertCustomer = db.prepare(`INSERT INTO stripe_customers(id, name, email, currency,
        active_subscription_count, current_mrr_ht_cents, lifetime_spend_ht_cents, paid_invoice_count,
        first_paid_at, last_paid_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertOffer = db.prepare(`INSERT INTO stripe_customer_offers(customer_id, subscription_id, price_id,
        product_id, product_name, interval, interval_count, quantity, monthly_mrr_ht_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertInvoice = db.prepare(`INSERT INTO stripe_invoices(id, customer_id, amount_ht_cents, currency, paid_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const customer of customers.values()) {
        insertCustomer.run(customer.id, customer.name, customer.email, customer.currency,
          customer.activeSubscriptionCount, Math.round(customer.currentMrrHtCents), Math.round(customer.lifetimeSpendHtCents),
          customer.paidInvoiceCount, customer.firstPaidAt, customer.lastPaidAt, syncedAt);
        for (const offer of customer.offers) insertOffer.run(customer.id, offer.subscriptionId, offer.priceId,
          offer.productId, offer.productName, offer.interval, offer.intervalCount, offer.quantity, offer.monthlyMrrHtCents);
      }
      for (const invoice of invoices) insertInvoice.run(invoice.id, invoice.customerId, Math.round(invoice.amountHtCents),
        invoice.currency, invoice.paidAt, syncedAt);
      db.prepare(`INSERT INTO stripe_metrics(id, mrr_cents, arr_cents, active_subscriptions, currency, synced_at)
        VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mrr_cents=excluded.mrr_cents,
        arr_cents=excluded.arr_cents, active_subscriptions=excluded.active_subscriptions, currency=excluded.currency, synced_at=excluded.synced_at`)
        .run(roundedMrr, roundedMrr * 12, activeSubscriptions, currency, syncedAt);
      db.prepare(`INSERT INTO stripe_metric_history(mrr_cents, arr_cents, active_subscriptions, currency, synced_at)
        VALUES (?, ?, ?, ?, ?)`).run(roundedMrr, roundedMrr * 12, activeSubscriptions, currency, syncedAt);
    });
    replace();
    db.prepare("UPDATE sync_runs SET status='success', completed_at=?, imported_count=?, message=? WHERE id=?")
      .run(syncedAt, activeSubscriptions + customers.size + invoices.length,
        `Lecture seule · ${customers.size} client(s) actif(s) · MRR HT`, run.lastInsertRowid);
    return { mrrCents: roundedMrr, activeSubscriptions, activeClients: customers.size, currency };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Erreur inconnue';
    const message = /permission|not have access|restricted/i.test(rawMessage)
      ? 'La clé Stripe doit autoriser en lecture : Subscriptions, Customers, Prices, Products et Invoices.'
      : rawMessage;
    db.prepare("UPDATE sync_runs SET status='error', completed_at=?, message=? WHERE id=?")
      .run(new Date().toISOString(), message, run.lastInsertRowid);
    throw new Error(message);
  }
};
