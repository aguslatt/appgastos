import { useMemo } from 'react';
import { monthKeyOf } from '../lib/dates';
import { computeCapacity, type Capacity } from '../lib/goals';
import { analyzeMonth } from '../lib/insights';
import { useToday } from './derived';
import { useData } from './store';

/** How much room there is each month, from the user's income and their real spending. */
export function useCapacity(): Capacity {
  const { expenses, categories, recurring, settings } = useData();
  const today = useToday();
  return useMemo(() => {
    const analysis = analyzeMonth({ month: monthKeyOf(today), today, expenses, categories, recurring, budget: settings.monthlyBudget });
    return computeCapacity({ expenses, today, income: settings.monthlyIncome, projection: analysis.projection?.total ?? null });
  }, [expenses, categories, recurring, settings.monthlyBudget, settings.monthlyIncome, today]);
}
