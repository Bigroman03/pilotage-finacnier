import type Database from 'better-sqlite3';

export type DashboardMode = 'day' | 'week' | 'month' | 'year' | 'custom';
export type DashboardBucket = Exclude<DashboardMode, 'custom'>;

export type DashboardPeriod = {
  mode: DashboardMode;
  bucket: DashboardBucket;
  from: string;
  to: string;
  label: string;
};

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const daysBetween = (from: string, to: string) => Math.floor((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);

const startOfWeek = (date: Date) => {
  const result = new Date(date);
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
};

const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const startOfYear = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), 0, 1));

export const resolveDashboardPeriod = (
  mode: DashboardMode,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): DashboardPeriod => {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from: Date;
  let to = today;
  let bucket: DashboardBucket = mode === 'custom' ? 'day' : mode;

  if (mode === 'day') {
    from = new Date(today); from.setUTCDate(from.getUTCDate() - 29);
  } else if (mode === 'week') {
    from = startOfWeek(today); from.setUTCDate(from.getUTCDate() - 77);
  } else if (mode === 'month') {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  } else if (mode === 'year') {
    from = new Date(Date.UTC(today.getUTCFullYear() - 4, 0, 1));
  } else {
    if (!customFrom || !customTo || !/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      throw new Error('Sélectionne une date de début et une date de fin valides.');
    }
    if (customTo < customFrom) throw new Error('La date de fin doit être postérieure à la date de début.');
    from = parseDate(customFrom);
    to = parseDate(customTo);
    const days = daysBetween(customFrom, customTo);
    bucket = days <= 45 ? 'day' : days <= 180 ? 'week' : days <= 1_095 ? 'month' : 'year';
  }

  const fromValue = dateOnly(from);
  const toValue = dateOnly(to);
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return {
    mode,
    bucket,
    from: fromValue,
    to: toValue,
    label: `Du ${formatter.format(from)} au ${formatter.format(to)}`,
  };
};

const bucketStart = (date: Date, bucket: DashboardBucket) => {
  if (bucket === 'week') return startOfWeek(date);
  if (bucket === 'month') return startOfMonth(date);
  if (bucket === 'year') return startOfYear(date);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const nextBucket = (date: Date, bucket: DashboardBucket) => {
  const next = new Date(date);
  if (bucket === 'day') next.setUTCDate(next.getUTCDate() + 1);
  if (bucket === 'week') next.setUTCDate(next.getUTCDate() + 7);
  if (bucket === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  if (bucket === 'year') next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
};

const bucketLabel = (date: Date, bucket: DashboardBucket) => {
  if (bucket === 'year') return String(date.getUTCFullYear());
  if (bucket === 'month') return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const short = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return bucket === 'week' ? `Sem. ${short}` : short;
};

export const getDashboardTrend = (db: Database.Database, period: DashboardPeriod) => {
  const transactionRows = db.prepare(`SELECT date, side, amount_cents FROM transactions
    WHERE status = 'completed' AND currency = 'EUR' AND date >= ? AND date <= ? ORDER BY date ASC`)
    .all(`${period.from}T00:00:00.000Z`, `${period.to}T23:59:59.999Z`) as Array<{ date: string; side: 'credit' | 'debit'; amount_cents: number }>;
  const invoiceRows = db.prepare(`SELECT paid_at, amount_ht_cents FROM stripe_invoices
    WHERE currency = 'EUR' AND paid_at >= ? AND paid_at <= ? ORDER BY paid_at ASC`)
    .all(`${period.from}T00:00:00.000Z`, `${period.to}T23:59:59.999Z`) as Array<{ paid_at: string; amount_ht_cents: number }>;
  const totals = new Map<string, { inflowsCents: number; outflowsCents: number; revenueHtCents: number }>();
  const keyFor = (value: string) => dateOnly(bucketStart(new Date(value), period.bucket));

  for (const row of transactionRows) {
    const key = keyFor(row.date);
    const current = totals.get(key) || { inflowsCents: 0, outflowsCents: 0, revenueHtCents: 0 };
    if (row.side === 'credit') current.inflowsCents += row.amount_cents;
    else current.outflowsCents += row.amount_cents;
    totals.set(key, current);
  }
  for (const row of invoiceRows) {
    const key = keyFor(row.paid_at);
    const current = totals.get(key) || { inflowsCents: 0, outflowsCents: 0, revenueHtCents: 0 };
    current.revenueHtCents += row.amount_ht_cents;
    totals.set(key, current);
  }

  const points = [];
  const end = parseDate(period.to);
  for (let cursor = bucketStart(parseDate(period.from), period.bucket); cursor <= end; cursor = nextBucket(cursor, period.bucket)) {
    const key = dateOnly(cursor);
    const values = totals.get(key) || { inflowsCents: 0, outflowsCents: 0, revenueHtCents: 0 };
    points.push({ key, label: bucketLabel(cursor, period.bucket), ...values, netCents: values.inflowsCents - values.outflowsCents });
  }
  return points;
};
