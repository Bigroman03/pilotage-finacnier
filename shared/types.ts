export type ExpenseKind = 'monthly' | 'one_off';
export type PlannedTaxMode = 'ht' | 'ttc' | 'reverse_charge';

export type PlannedExpense = {
  id: number;
  label: string;
  vendor: string;
  amountCents: number;
  enteredAmountCents: number;
  taxMode: PlannedTaxMode;
  vatRateBasisPoints: number;
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

export type VendorRanking = {
  rank: number;
  vendor: string;
  category: string;
  subcategory: string;
  totalCents: number;
  averageTransactionCents: number;
  transactionCount: number;
  activeMonths: number;
  lastSeenAt: string;
  sharePercent: number;
  recurring: boolean;
  estimatedMonthlyCents: number | null;
};

export type CashflowMonth = {
  key: string;
  label: string;
  inflowsCents: number;
  outflowsCents: number;
  netCents: number;
};

export type FinancialSettings = {
  receivablesCents: number;
  inventoryCents: number;
  supplierDebtsCents: number;
  updatedAt: string | null;
};

export type FinancialKpiResponse = {
  settings: FinancialSettings;
  metrics: {
    cashBalanceCents: number;
    mrrHtCents: number;
    arrHtCents: number;
    currentMonthInflowsCents: number;
    currentMonthOutflowsCents: number;
    currentMonthNetCents: number;
    averageMonthlyOutflowsCents: number;
    recurringCostsCents: number;
    burnRateCents: number;
    runwayMonths: number | null;
    bfrCents: number;
    recurringCoveragePercent: number | null;
  };
  cashflowMonths: CashflowMonth[];
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
  cashflowMonths: CashflowMonth[];
  recentExpenses: ExpenseTransaction[];
  upcomingPlanned: PlannedExpense[];
};

export type StripeClientOffer = {
  subscriptionId: string;
  priceId: string;
  productId: string | null;
  productName: string;
  interval: string;
  intervalCount: number;
  quantity: number;
  monthlyMrrHtCents: number;
};

export type StripeClient = {
  rank: number;
  id: string;
  name: string;
  email: string | null;
  currency: string;
  activeSubscriptionCount: number;
  currentMrrHtCents: number;
  lifetimeSpendHtCents: number;
  paidInvoiceCount: number;
  averageInvoiceHtCents: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  offers: StripeClientOffer[];
};

export type ClientsResponse = {
  summary: {
    activeClientCount: number;
    activeSubscriptionCount: number;
    totalMrrHtCents: number;
    averageMonthlyBasketHtCents: number;
    lifetimeSpendHtCents: number;
    paidInvoiceCount: number;
    averageInvoiceHtCents: number;
  };
  clients: StripeClient[];
};
