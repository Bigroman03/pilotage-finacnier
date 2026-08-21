import type Database from 'better-sqlite3';
import type {
  CashflowMonth, ExpenseHierarchy, ExpenseTransaction, FinancialSettings, ForecastMonth,
  PlannedExpense, RecurringVendor, VendorRanking,
} from '../shared/types.js';
import { plannedExpenseOccursInMonth } from '../shared/forecast.js';

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
  entered_amount_cents: number | null;
  tax_mode: 'ht' | 'ttc' | 'no_vat' | 'reverse_charge';
  vat_rate_basis_points: number;
  category: string;
  subcategory: string;
  kind: 'monthly' | 'quarterly' | 'yearly' | 'one_off';
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
  enteredAmountCents: row.entered_amount_cents ?? row.amount_cents,
  taxMode: row.tax_mode || 'ht',
  vatRateBasisPoints: row.vat_rate_basis_points ?? 2000,
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

export const plannedAmountExcludingTax = (
  enteredAmountCents: number,
  taxMode: 'ht' | 'ttc' | 'no_vat' | 'reverse_charge',
  vatRateBasisPoints: number,
) => taxMode === 'ttc'
  ? Math.round(enteredAmountCents / (1 + Math.max(0, vatRateBasisPoints) / 10_000))
  : enteredAmountCents;

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

export const rankVendors = (db: Database.Database): VendorRanking[] => {
  const transactions = getExpenseTransactions(db);
  const totalExpenses = transactions.reduce((sum, row) => sum + row.amountCents, 0);
  const recurring = new Map(detectRecurringVendors(db).map((vendor) => [vendor.vendor, vendor]));
  const groups = new Map<string, ExpenseTransaction[]>();
  transactions.forEach((row) => groups.set(row.vendor, [...(groups.get(row.vendor) || []), row]));

  return Array.from(groups.entries()).map(([vendor, rows]) => {
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    const totalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    const recurringVendor = recurring.get(vendor);
    return {
      rank: 0,
      vendor,
      category: latest.category,
      subcategory: latest.subcategory,
      totalCents,
      averageTransactionCents: Math.round(totalCents / rows.length),
      transactionCount: rows.length,
      activeMonths: new Set(rows.map((row) => monthKey(row.date))).size,
      lastSeenAt: latest.date,
      sharePercent: totalExpenses ? Math.round((totalCents / totalExpenses) * 10_000) / 100 : 0,
      recurring: Boolean(recurringVendor),
      estimatedMonthlyCents: recurringVendor?.estimatedMonthlyCents || null,
    };
  }).sort((a, b) => b.totalCents - a.totalCents).map((vendor, index) => ({ ...vendor, rank: index + 1 }));
};

const addCalendarMonths = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth() + count, 1);

export const getCashflowMonths = (db: Database.Database, count = 6, now = new Date()): CashflowMonth[] => {
  const monthCount = Math.min(24, Math.max(1, Math.floor(count)));
  const start = addCalendarMonths(new Date(now.getFullYear(), now.getMonth(), 1), -(monthCount - 1));
  const rows = db.prepare(`SELECT date, side, amount_cents FROM transactions
    WHERE status = 'completed' AND currency = 'EUR' AND date >= ? ORDER BY date ASC`)
    .all(start.toISOString()) as Array<{ date: string; side: 'credit' | 'debit'; amount_cents: number }>;
  const totals = new Map<string, { inflowsCents: number; outflowsCents: number }>();
  rows.forEach((row) => {
    const key = monthKey(row.date);
    const current = totals.get(key) || { inflowsCents: 0, outflowsCents: 0 };
    if (row.side === 'credit') current.inflowsCents += row.amount_cents;
    else current.outflowsCents += row.amount_cents;
    totals.set(key, current);
  });

  return Array.from({ length: monthCount }, (_, index) => {
    const month = addCalendarMonths(start, index);
    const key = localMonthKey(month);
    const values = totals.get(key) || { inflowsCents: 0, outflowsCents: 0 };
    return {
      key,
      label: month.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      ...values,
      netCents: values.inflowsCents - values.outflowsCents,
    };
  });
};

export const getFinancialSettings = (db: Database.Database): FinancialSettings => {
  const row = db.prepare('SELECT * FROM financial_settings WHERE id = 1').get() as {
    receivables_cents: number; inventory_cents: number; supplier_debts_cents: number; updated_at: string;
  } | undefined;
  return {
    receivablesCents: row?.receivables_cents || 0,
    inventoryCents: row?.inventory_cents || 0,
    supplierDebtsCents: row?.supplier_debts_cents || 0,
    updatedAt: row?.updated_at || null,
  };
};

export const calculateBfr = (settings: Pick<FinancialSettings, 'receivablesCents' | 'inventoryCents' | 'supplierDebtsCents'>) =>
  settings.receivablesCents + settings.inventoryCents - settings.supplierDebtsCents;

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
    const activePlans = input.plannedExpenses.filter((expense) => plannedExpenseOccursInMonth(expense, key));
    const plannedMonthlyCents = activePlans.filter((expense) => expense.kind === 'monthly').reduce((sum, expense) => sum + expense.amountCents, 0);
    const plannedQuarterlyCents = activePlans.filter((expense) => expense.kind === 'quarterly').reduce((sum, expense) => sum + expense.amountCents, 0);
    const plannedYearlyCents = activePlans.filter((expense) => expense.kind === 'yearly').reduce((sum, expense) => sum + expense.amountCents, 0);
    const plannedOneOffCents = activePlans.filter((expense) => expense.kind === 'one_off').reduce((sum, expense) => sum + expense.amountCents, 0);
    const totalExpensesCents = recurringQontoCents + plannedMonthlyCents + plannedQuarterlyCents + plannedYearlyCents + plannedOneOffCents;
    projectedBalanceCents += input.stripeMrrCents - totalExpensesCents;

    return {
      key,
      label: monthDate.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      recurringQontoCents,
      plannedMonthlyCents,
      plannedQuarterlyCents,
      plannedYearlyCents,
      plannedOneOffCents,
      totalExpensesCents,
      stripeMrrCents: input.stripeMrrCents,
      projectedBalanceCents,
    };
  });
};
