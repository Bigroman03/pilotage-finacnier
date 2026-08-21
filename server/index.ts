import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { getDatabase } from './db.js';
import {
  buildExpenseHierarchy,
  buildForecast,
  calculateBfr,
  detectRecurringVendors,
  getCashflowMonths,
  getExpenseTransactions,
  getFinancialSettings,
  listPlannedExpenses,
  mapPlannedExpense,
  plannedAmountExcludingTax,
  rankVendors,
} from './analytics.js';
import { EXPENSE_CATEGORIES } from './classification.js';
import { isQontoConfigured, syncQonto } from './qonto.js';
import { isStripeConfigured, syncStripe } from './stripe.js';
import { getDashboardTrend, resolveDashboardPeriod } from './dashboard.js';

const app = express();
const db = getDatabase();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const asyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => void handler(req, res).catch(next);

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const plannedExpenseSchema = z.object({
  label: z.string().trim().min(2).max(160),
  vendor: z.string().trim().min(2).max(120),
  enteredAmountCents: z.coerce.number().int().positive().max(1_000_000_000),
  taxMode: z.enum(['ht', 'ttc', 'no_vat', 'reverse_charge']),
  vatRateBasisPoints: z.coerce.number().int().min(0).max(10_000),
  category: z.string().trim().min(2).max(100),
  subcategory: z.string().trim().min(2).max(100),
  kind: z.enum(['monthly', 'quarterly', 'yearly', 'one_off']),
  startDate: z.string().regex(dateOnly),
  endDate: z.string().regex(dateOnly).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional().default(true),
}).refine((value) => !value.endDate || value.endDate >= value.startDate, {
  message: 'La date de fin doit être postérieure à la date de début.',
  path: ['endDate'],
});

app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

app.get('/api/connections', (_req, res) => {
  const runs = db.prepare(`SELECT source, status, completed_at, imported_count, message
    FROM sync_runs WHERE id IN (SELECT MAX(id) FROM sync_runs GROUP BY source)`).all();
  res.json({
    qonto: { configured: isQontoConfigured(), lastRun: runs.find((row: any) => row.source === 'qonto') || null },
    stripe: { configured: isStripeConfigured(), lastRun: runs.find((row: any) => row.source === 'stripe') || null },
  });
});

app.post('/api/sync/qonto', asyncRoute(async (_req, res) => res.json(await syncQonto(db))));
app.post('/api/sync/stripe', asyncRoute(async (_req, res) => res.json(await syncStripe(db))));

app.get('/api/categories', (_req, res) => res.json({ categories: EXPENSE_CATEGORIES }));

app.get('/api/expenses', (req, res) => {
  const filters = {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    vendor: typeof req.query.vendor === 'string' ? req.query.vendor : undefined,
    search: typeof req.query.search === 'string' ? req.query.search.trim() : undefined,
  };
  const transactions = getExpenseTransactions(db, filters);
  res.json({
    totalCents: transactions.reduce((sum, row) => sum + row.amountCents, 0),
    transactionCount: transactions.length,
    hierarchy: buildExpenseHierarchy(transactions),
  });
});

app.get('/api/vendors/recurring', (_req, res) => {
  const vendors = detectRecurringVendors(db);
  res.json({
    totalMonthlyCents: vendors.reduce((sum, vendor) => sum + vendor.estimatedMonthlyCents, 0),
    vendors,
  });
});

app.get('/api/vendors', (_req, res) => {
  const vendors = rankVendors(db);
  const recurring = detectRecurringVendors(db);
  res.json({
    totalExpenseCents: vendors.reduce((sum, vendor) => sum + vendor.totalCents, 0),
    recurringMonthlyCents: recurring.reduce((sum, vendor) => sum + vendor.estimatedMonthlyCents, 0),
    recurringCount: recurring.length,
    vendors,
    recurringVendors: recurring,
  });
});

app.get('/api/clients', (_req, res) => {
  const lastRun = db.prepare(`SELECT status, completed_at, message FROM sync_runs
    WHERE source = 'stripe' ORDER BY id DESC LIMIT 1`).get() as { status: string; completed_at: string | null; message: string | null } | undefined;
  const rows = db.prepare(`SELECT * FROM stripe_customers
    ORDER BY lifetime_spend_ht_cents DESC, current_mrr_ht_cents DESC, name COLLATE NOCASE`).all() as any[];
  const offers = db.prepare(`SELECT * FROM stripe_customer_offers
    ORDER BY monthly_mrr_ht_cents DESC, product_name COLLATE NOCASE`).all() as any[];
  const offersByCustomer = new Map<string, any[]>();
  for (const offer of offers) offersByCustomer.set(offer.customer_id, [...(offersByCustomer.get(offer.customer_id) || []), offer]);
  const clients = rows.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    name: row.name,
    email: row.email,
    currency: row.currency,
    activeSubscriptionCount: row.active_subscription_count,
    currentMrrHtCents: row.current_mrr_ht_cents,
    lifetimeSpendHtCents: row.lifetime_spend_ht_cents,
    paidInvoiceCount: row.paid_invoice_count,
    averageInvoiceHtCents: row.paid_invoice_count ? Math.round(row.lifetime_spend_ht_cents / row.paid_invoice_count) : 0,
    firstPaidAt: row.first_paid_at,
    lastPaidAt: row.last_paid_at,
    offers: (offersByCustomer.get(row.id) || []).map((offer) => ({
      subscriptionId: offer.subscription_id,
      priceId: offer.price_id,
      productId: offer.product_id,
      productName: offer.product_name,
      interval: offer.interval,
      intervalCount: offer.interval_count,
      quantity: offer.quantity,
      monthlyMrrHtCents: offer.monthly_mrr_ht_cents,
    })),
  }));
  const totalMrrHtCents = clients.reduce((sum, client) => sum + client.currentMrrHtCents, 0);
  const lifetimeSpendHtCents = clients.reduce((sum, client) => sum + client.lifetimeSpendHtCents, 0);
  const paidInvoiceCount = clients.reduce((sum, client) => sum + client.paidInvoiceCount, 0);
  res.json({
    sync: {
      configured: isStripeConfigured(),
      lastRun: lastRun ? { status: lastRun.status, completedAt: lastRun.completed_at, message: lastRun.message } : null,
    },
    summary: {
      activeClientCount: clients.length,
      activeSubscriptionCount: clients.reduce((sum, client) => sum + client.activeSubscriptionCount, 0),
      totalMrrHtCents,
      averageMonthlyBasketHtCents: clients.length ? Math.round(totalMrrHtCents / clients.length) : 0,
      lifetimeSpendHtCents,
      paidInvoiceCount,
      averageInvoiceHtCents: paidInvoiceCount ? Math.round(lifetimeSpendHtCents / paidInvoiceCount) : 0,
    },
    clients,
  });
});

app.patch('/api/vendors/:vendor', (req, res) => {
  const schema = z.object({
    displayName: z.string().trim().min(2).max(120).nullable().optional(),
    category: z.string().trim().min(2).max(100).nullable().optional(),
    subcategory: z.string().trim().min(2).max(100).nullable().optional(),
    recurringStatus: z.enum(['auto', 'monthly', 'not_recurring']),
    monthlyOverrideCents: z.coerce.number().int().positive().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  });
  const value = schema.parse(req.body);
  const vendor = decodeURIComponent(req.params.vendor);
  db.prepare(`INSERT INTO vendor_overrides(vendor, display_name, category, subcategory, recurring_status, monthly_override_cents, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(vendor) DO UPDATE SET display_name=excluded.display_name,
    category=excluded.category, subcategory=excluded.subcategory, recurring_status=excluded.recurring_status,
    monthly_override_cents=excluded.monthly_override_cents, notes=excluded.notes, updated_at=excluded.updated_at`)
    .run(vendor, value.displayName || null, value.category || null, value.subcategory || null, value.recurringStatus,
      value.monthlyOverrideCents || null, value.notes || null, new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/planned-expenses', (_req, res) => res.json({ expenses: listPlannedExpenses(db) }));

app.post('/api/planned-expenses', (req, res) => {
  const value = plannedExpenseSchema.parse(req.body);
  const now = new Date().toISOString();
  const amountCents = plannedAmountExcludingTax(value.enteredAmountCents, value.taxMode, value.vatRateBasisPoints);
  const result = db.prepare(`INSERT INTO planned_expenses(label, vendor, amount_cents, entered_amount_cents, tax_mode,
    vat_rate_basis_points, category, subcategory, kind, start_date, end_date, notes, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
    .run(value.label, value.vendor, amountCents, value.enteredAmountCents, value.taxMode, value.vatRateBasisPoints,
      value.category, value.subcategory, value.kind,
      value.startDate, value.endDate || null, value.notes || null, value.active ? 1 : 0, now, now);
  const row = db.prepare('SELECT * FROM planned_expenses WHERE id = ?').get(result.lastInsertRowid) as any;
  res.status(201).json({ expense: mapPlannedExpense(row) });
});

app.put('/api/planned-expenses/:id', (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const value = plannedExpenseSchema.parse(req.body);
  const amountCents = plannedAmountExcludingTax(value.enteredAmountCents, value.taxMode, value.vatRateBasisPoints);
  const result = db.prepare(`UPDATE planned_expenses SET label=?, vendor=?, amount_cents=?, entered_amount_cents=?,
    tax_mode=?, vat_rate_basis_points=?, category=?, subcategory=?, kind=?, start_date=?, end_date=?, notes=?,
    active=?, updated_at=? WHERE id=?`)
    .run(value.label, value.vendor, amountCents, value.enteredAmountCents, value.taxMode, value.vatRateBasisPoints,
      value.category, value.subcategory, value.kind,
      value.startDate, value.endDate || null, value.notes || null, value.active ? 1 : 0, new Date().toISOString(), id);
  if (!result.changes) return res.status(404).json({ error: 'Dépense introuvable.' });
  const row = db.prepare('SELECT * FROM planned_expenses WHERE id = ?').get(id) as any;
  return res.json({ expense: mapPlannedExpense(row) });
});

app.delete('/api/planned-expenses/:id', (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const result = db.prepare('DELETE FROM planned_expenses WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Dépense introuvable.' });
  return res.status(204).send();
});

app.get('/api/kpis', (_req, res) => {
  const settings = getFinancialSettings(db);
  const cashflowMonths = getCashflowMonths(db, 7);
  const current = cashflowMonths.at(-1)!;
  const completedMonths = cashflowMonths.slice(-4, -1);
  const referenceMonths = completedMonths.some((month) => month.inflowsCents || month.outflowsCents)
    ? completedMonths
    : [current];
  const averageInflowsCents = Math.round(referenceMonths.reduce((sum, month) => sum + month.inflowsCents, 0) / referenceMonths.length);
  const averageMonthlyOutflowsCents = Math.round(referenceMonths.reduce((sum, month) => sum + month.outflowsCents, 0) / referenceMonths.length);
  const burnRateCents = Math.max(0, averageMonthlyOutflowsCents - averageInflowsCents);
  const cashBalanceCents = (db.prepare("SELECT COALESCE(SUM(balance_cents), 0) value FROM bank_accounts WHERE currency='EUR'").get() as { value: number }).value;
  const stripe = db.prepare('SELECT * FROM stripe_metrics WHERE id=1').get() as { mrr_cents: number; arr_cents: number } | undefined;
  const recurringCostsCents = detectRecurringVendors(db).reduce((sum, vendor) => sum + vendor.estimatedMonthlyCents, 0);
  const mrrHtCents = stripe?.mrr_cents || 0;

  res.json({
    settings,
    metrics: {
      cashBalanceCents,
      mrrHtCents,
      arrHtCents: stripe?.arr_cents || mrrHtCents * 12,
      currentMonthInflowsCents: current.inflowsCents,
      currentMonthOutflowsCents: current.outflowsCents,
      currentMonthNetCents: current.netCents,
      averageMonthlyOutflowsCents,
      recurringCostsCents,
      burnRateCents,
      runwayMonths: burnRateCents > 0 ? Math.round((cashBalanceCents / burnRateCents) * 10) / 10 : null,
      bfrCents: calculateBfr(settings),
      recurringCoveragePercent: recurringCostsCents > 0 ? Math.round((mrrHtCents / recurringCostsCents) * 1000) / 10 : null,
    },
    cashflowMonths: cashflowMonths.slice(-6),
  });
});

app.put('/api/kpis/settings', (req, res) => {
  const value = z.object({
    receivablesCents: z.coerce.number().int().min(0).max(100_000_000_000),
    inventoryCents: z.coerce.number().int().min(0).max(100_000_000_000),
    supplierDebtsCents: z.coerce.number().int().min(0).max(100_000_000_000),
  }).parse(req.body);
  const updatedAt = new Date().toISOString();
  db.prepare(`INSERT INTO financial_settings(id, receivables_cents, inventory_cents, supplier_debts_cents, updated_at)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET receivables_cents=excluded.receivables_cents,
    inventory_cents=excluded.inventory_cents, supplier_debts_cents=excluded.supplier_debts_cents,
    updated_at=excluded.updated_at`)
    .run(value.receivablesCents, value.inventoryCents, value.supplierDebtsCents, updatedAt);
  res.json({ settings: getFinancialSettings(db) });
});

app.get('/api/forecast', (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months || 12)));
  const cashBalanceCents = (db.prepare("SELECT COALESCE(SUM(balance_cents), 0) value FROM bank_accounts WHERE currency='EUR'").get() as { value: number }).value;
  const stripe = db.prepare('SELECT * FROM stripe_metrics WHERE id=1').get() as { mrr_cents: number } | undefined;
  const recurringVendors = detectRecurringVendors(db);
  const plannedExpenses = listPlannedExpenses(db);
  const monthsData = buildForecast({
    start: new Date(), months, cashBalanceCents, stripeMrrCents: stripe?.mrr_cents || 0, recurringVendors, plannedExpenses,
  });
  res.json({
    assumptions: {
      cashBalanceCents,
      stripeMrrCents: stripe?.mrr_cents || 0,
      recurringQontoCents: recurringVendors.reduce((sum, vendor) => sum + vendor.estimatedMonthlyCents, 0),
    },
    months: monthsData,
    plannedExpenses,
  });
});

app.get('/api/dashboard', (req, res) => {
  const now = new Date();
  const mode = z.enum(['day', 'week', 'month', 'year', 'custom']).catch('month').parse(req.query.period);
  const period = resolveDashboardPeriod(mode,
    typeof req.query.from === 'string' ? req.query.from : undefined,
    typeof req.query.to === 'string' ? req.query.to : undefined,
    now);
  const next30 = new Date(now.getTime() + 30 * 86400_000);
  const periodExpenses = getExpenseTransactions(db, { from: period.from, to: period.to });
  const recurring = detectRecurringVendors(db);
  const planned = listPlannedExpenses(db);
  const stripe = db.prepare('SELECT * FROM stripe_metrics WHERE id=1').get() as { mrr_cents: number; active_subscriptions: number; synced_at: string } | undefined;
  const qontoRun = db.prepare("SELECT completed_at FROM sync_runs WHERE source='qonto' AND status='success' ORDER BY id DESC LIMIT 1").get() as { completed_at: string } | undefined;
  const stripeRun = db.prepare("SELECT completed_at FROM sync_runs WHERE source='stripe' AND status='success' ORDER BY id DESC LIMIT 1").get() as { completed_at: string } | undefined;
  const upcoming = planned.filter((expense) => expense.active && new Date(expense.startDate) <= next30).slice(0, 8);
  const hierarchy = buildExpenseHierarchy(periodExpenses);
  const trend = getDashboardTrend(db, period);
  const revenueHtCents = trend.reduce((sum, point) => sum + point.revenueHtCents, 0);

  res.json({
    period,
    connections: {
      qonto: isQontoConfigured(), stripe: isStripeConfigured(), qontoLastSync: qontoRun?.completed_at || null, stripeLastSync: stripeRun?.completed_at || null,
    },
    kpis: {
      cashBalanceCents: (db.prepare("SELECT COALESCE(SUM(balance_cents), 0) value FROM bank_accounts WHERE currency='EUR'").get() as { value: number }).value,
      periodExpensesCents: periodExpenses.reduce((sum, row) => sum + row.amountCents, 0),
      revenueHtCents,
      recurringMonthlyCents: recurring.reduce((sum, vendor) => sum + vendor.estimatedMonthlyCents, 0),
      plannedNext30DaysCents: upcoming.reduce((sum, expense) => sum + expense.amountCents, 0),
      stripeMrrCents: stripe?.mrr_cents || 0,
      activeStripeSubscriptions: stripe?.active_subscriptions || 0,
    },
    topCategories: hierarchy.slice(0, 7).map((category) => ({ name: category.category, valueCents: category.totalCents })),
    trend,
    recentExpenses: periodExpenses.slice(0, 8),
    upcomingPlanned: upcoming,
  });
});

const distDirectory = resolve('dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve(distDirectory, 'index.html')));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join(' ')
    : error instanceof Error ? error.message : 'Erreur interne.';
  console.error('[pilotage]', message);
  res.status(error instanceof z.ZodError ? 400 : 500).json({ error: message });
});

app.listen(port, host, () => {
  console.log(`Pilotage financier disponible sur http://${host}:${port}`);
});
