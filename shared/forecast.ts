import type { PlannedExpense } from './types.js';

const monthIndex = (value: string) => {
  const [year, month] = value.slice(0, 7).split('-').map(Number);
  return year * 12 + month - 1;
};

export const plannedExpenseOccursInMonth = (
  expense: PlannedExpense,
  monthKey: string,
  includeInactive = false,
) => {
  if (!includeInactive && !expense.active) return false;
  const target = monthIndex(monthKey);
  const start = monthIndex(expense.startDate);
  const end = expense.endDate ? monthIndex(expense.endDate) : null;
  if (target < start || (end !== null && target > end)) return false;
  if (expense.kind === 'one_off') return target === start;
  const elapsed = target - start;
  if (expense.kind === 'quarterly') return elapsed % 3 === 0;
  if (expense.kind === 'yearly') return elapsed % 12 === 0;
  return true;
};
