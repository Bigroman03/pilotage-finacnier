import type Database from 'better-sqlite3';
import type { ExpenseHierarchy, ExpenseTransaction, ForecastMonth, PlannedExpense, RecurringVendor } from '../shared/types.js';

type TransactionRow = {
  id: string;
  external_id: string;
  bank_account_id: string;
  date: string;
  vendor: string;
  label: string;
  amount_cents: number;
  currency: string;
  category: string;
  subcategory: string;
  qonto_category: string | null;
  operation_type: string;
  status: string;
  reference: string | null;
  note: string | null;
};

type PlannedRow = {
  id: number;
  label: string;
  vendor: string;
  amount_cents: number;
  category: string;
  subcategory: string;
  kind: 'monthly' | 'one_off';
  start_date: string;
  end_date: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};

export const mapTransaction = (row: TransactionRow): ExpenseTransaction => ({
  id: row.id,
  externalId: row.external_id,
  bankAccountId: row.bank_account_id,
  date: row.date,
  vendor: row.vendor,
  label: row.label,
  amountCents: row.amount_cents,
  currency: row.currency,
  category: row.category,
  subcategory: row.subcategory,
  qontoCategory: row.qonto_category,
  operationType: row.operation_type,
  status: row.status,
  reference: row.reference,
  note: row.note,
});

export const mapPlannedExpense = (row: PlannedRow): PlannedExpense => ({
  id: row.id,
  label: row.label,
  vendor: row.vendor,
  amountCents: row.amount_cents,
  category: row.category,
  subcategory: row.subcategory,
  kind: row.kind,
  startDate: row.start_date,
  endDate: row.end_date,
  notes: row.notes,
  active: Boolean(row.active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getExpenseTransactions = (db: Database.Database, filters: {
  from?: string;
  to?: string;
  category?: string;
  vendor?: string;
  search?: string;
} = {}) => {
  const conditions = ["side = 'debit'", "status IN ('completed', 'pending')", "currency = 'EUR'"];
  const params: Record<string, string> = {};

  if (filters.from) { conditions.push('date >= @from'); params.from = filters.from; }
  if (filters.to) { conditions.push('date <= @to'); params.to = `${filters.to}T23:59:59.999Z`; }
  if (filters.category) { conditions.push('category = @category'); params.category = filters.category; }
  if (filters.vendor) { conditions.push('vendor = @vendor'); params.vendor = filters.vendor; }
  if (filters.search) {
    conditions.push('(label LIKE @search OR vendor LIKE @search OR reference LIKE @search OR note LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  return (db.prepare(`SELECT id, external_id, bank_account_id, date, vendor, label, amount_cents, currency,
    category, subcategory, qonto_category, operation_type, status, reference, note
    FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date DESC`).all(params) as TransactionRow[]).map(mapTransaction);
};

export const buildExpenseHierarchy = (transactions: ExpenseTransaction[]): ExpenseHierarchy[] => {
  const categories = new Map<string, Map<string, Map<string, ExpenseTransaction[]>>>();
  transactions.forEach((transaction) => {
    if (!categories.has(transaction.category)) categories.set(transaction.category, new Map());
    const subcategories = categories.get(transaction.category)!;
    if (!subcategories.has(transaction.subcategory)) subcategories.set(transaction.subcategory, new Map());
    const vendors = subcategories.get(transaction.subcategory)!;
    vendors.set(transaction.vendor, [...(vendors.get(transaction.vendor) || []), transaction]);
  });

  return Array.from(categories.entries()).map(([category, subcategories]) => {
    const subcategoryRows = Array.from(subcategories.entries()).map(([subcategory, vendors]) => {
      const vendorRows = Array.from(vendors.entries()).map(([vendor, rows]) => ({
        vendor,
        totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
        transactionCount: rows.length,
        transactions: rows,
      })).sort((a, b) => b.totalCents - a.totalCents);
      return {
        subcategory,
        totalCents: vendorRows.reduce((sum, row) => sum + row.totalCents, 0),
        transactionCount: vendorRows.reduce((sum, row) => sum + row.transactionCount, 0),
        vendors: vendorRows,
      };
    }).sort((a, b) => b.totalCents - a.totalCents);
    return {
      category,
      totalCents: subcategoryRows.reduce((sum, row) => sum + row.totalCents, 0),
      transactionCount: subcategoryRows.reduce((sum, row) => sum + row.transactionCount, 0),
      subcategories: subcategoryRows,
    };
  }).sort((a, b) => b.totalCents - a.totalCents);
};

const monthKey = (iso: string) => iso.slice(0, 7);

export const detectRecurringVendors = (db: Database.Database): RecurringVendor[] => {
  const rows = getExpenseTransactions(db);
  const overrides = db.prepare('SELECT * FROM vendor_overrides').all() as Array<{
    vendor: string; display_name: string | null; category: string | null; subcategory: string | null;
    recurring_status: 'auto' | 'monthly' | 'not_recurring'; monthly_override_cents: number | null;
  }>;
  const overrideMap = new Map(overrides.map((override) => [override.vendor, override]));
  const groups = new Map<string, ExpenseTransaction[]>();
  rows.forEach((row) => groups.set(row.vendor, [...(groups.get(row.vendor) || []), row]));

  return Array.from(groups.entries()).flatMap(([vendor, transactions]) => {
    const override = overrideMap.get(vendor);
    if (override?.recurring_status === 'not_recurring') return [];
    const months = new Map<string, number>();
    transactions.forEach((transaction) => {
      const key = monthKey(transaction.date);
      months.set(key, (months.get(key) || 0) + transaction.amountCents);
    });
    if (override?.recurring_status !== 'monthly' && months.size < 2) return [];

    const total = transactions.reduce((sum, row) => sum + row.amountCents, 0);
    const estimatedMonthlyCents = override?.monthly_override_cents
      || Math.round(Array.from(months.values()).reduce((sum, amount) => sum + amount, 0) / Math.max(1, months.size));
    const latest = [...transactions].sort((a, b) => b.date.localeCompare(a.date))[0];
    return [{
      vendor: override?.display_name || vendor,
      category: override?.category || latest.category,
      subcategory: override?.subcategory || latest.subcategory,
      estimatedMonthlyCents,
      averageTransactionCents: Math.round(total / transactions.length),
      occurrences: transactions.length,
      activeMonths: months.size,
      lastSeenAt: latest.date,
      confidence: months.size >= 4 ? 'high' as const : 'medium' as const,
    }];
  }).sort((a, b) => b.estimatedMonthlyCents - a.estimatedMonthlyCents);
};

export const listPlannedExpenses = (db: Database.Database) =>
  (db.prepare('SELECT * FROM planned_expenses ORDER BY active DESC, start_date ASC, amount_cents DESC').all() as PlannedRow[]).map(mapPlannedExpense);

const addMonths = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth() + count, 1);
const localMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const buildForecast = (input: {
  start: Date;
  months: number;
  cashBalanceCents: number;
  stripeMrrCents: number;
  recurringVendors: RecurringVendor[];
  plannedExpenses: PlannedExpense[];
}): ForecastMonth[] => {
  const recurringQontoCents = input.recurringVendors.reduce((sum, vendor) => sum + vendor.estimatedMonthlyCents, 0);
  let projectedBalanceCents = input.cashBalanceCents;

  return Array.from({ length: input.months }, (_, index) => {
    const monthDate = addMonths(input.start, index);
    const key = localMonthKey(monthDate);
    const monthStart = new Date(`${key}-01T00:00:00`);
    const monthEnd = addMonths(monthStart, 1);
    const activePlans = input.plannedExpenses.filter((expense) => {
      if (!expense.active) return false;
      const starts = new Date(`${expense.startDate}T00:00:00`);
      const ends = expense.endDate ? new Date(`${expense.endDate}T23:59:59`) : null;
      if (expense.kind === 'one_off') return starts >= monthStart && starts < monthEnd;
      return starts < monthEnd && (!ends || ends >= monthStart);
    });
    const plannedMonthlyCents = activePlans.filter((expense) => expense.kind === 'monthly').reduce((sum, expense) => sum + expense.amountCents, 0);
    const plannedOneOffCents = activePlans.filter((expense) => expense.kind === 'one_off').reduce((sum, expense) => sum + expense.amountCents, 0);
    const totalExpensesCents = recurringQontoCents + plannedMonthlyCents + plannedOneOffCents;
    projectedBalanceCents += input.stripeMrrCents - totalExpensesCents;

    return {
      key,
      label: monthDate.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      recurringQontoCents,
      plannedMonthlyCents,
      plannedOneOffCents,
      totalExpensesCents,
      stripeMrrCents: input.stripeMrrCents,
      projectedBalanceCents,
    };
  });
};
