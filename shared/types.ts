export type ExpenseKind = 'monthly' | 'one_off';

export type PlannedExpense = {
  id: number;
  label: string;
  vendor: string;
  amountCents: number;
  category: string;
  subcategory: string;
  kind: ExpenseKind;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseTransaction = {
  id: string;
  externalId: string;
  bankAccountId: string;
  date: string;
  vendor: string;
  label: string;
  amountCents: number;
  currency: string;
  category: string;
  subcategory: string;
  qontoCategory: string | null;
  operationType: string;
  status: string;
  reference: string | null;
  note: string | null;
};

export type ExpenseHierarchy = {
  category: string;
  totalCents: number;
  transactionCount: number;
  subcategories: Array<{
    subcategory: string;
    totalCents: number;
    transactionCount: number;
    vendors: Array<{
      vendor: string;
      totalCents: number;
      transactionCount: number;
      transactions: ExpenseTransaction[];
    }>;
  }>;
};

export type RecurringVendor = {
  vendor: string;
  category: string;
  subcategory: string;
  estimatedMonthlyCents: number;
  averageTransactionCents: number;
  occurrences: number;
  activeMonths: number;
  lastSeenAt: string;
  confidence: 'medium' | 'high';
};

export type ForecastMonth = {
  key: string;
  label: string;
  recurringQontoCents: number;
  plannedMonthlyCents: number;
  plannedOneOffCents: number;
  totalExpensesCents: number;
  stripeMrrCents: number;
  projectedBalanceCents: number;
};

export type DashboardResponse = {
  connections: {
    qonto: boolean;
    stripe: boolean;
    qontoLastSync: string | null;
    stripeLastSync: string | null;
  };
  kpis: {
    cashBalanceCents: number;
    currentMonthExpensesCents: number;
    recurringMonthlyCents: number;
    plannedNext30DaysCents: number;
    stripeMrrCents: number;
    activeStripeSubscriptions: number;
  };
  topCategories: Array<{ name: string; valueCents: number }>;
  recentExpenses: ExpenseTransaction[];
  upcomingPlanned: PlannedExpense[];
};

