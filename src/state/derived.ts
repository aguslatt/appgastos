import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createClassifier, type Classifier } from '../lib/classifier';
import { todayStr } from '../lib/dates';
import { expectedIncome, groupIncomesByMonth, type ExpectedIncome } from '../lib/income';
import { createIncomeSuggester, type IncomeSuggester } from '../lib/incomeSources';
import { getMoneyFormatter, type MoneyFormatter } from '../lib/money';
import { groupByMonth } from '../lib/stats';
import type { Category, DateStr, Expense, Income, MonthKey } from '../lib/types';
import { useData } from './store';

/** Today's date, kept fresh when the app stays open across midnight or comes back to the foreground. */
export function useTodayClock(): DateStr {
  const [today, setToday] = useState<DateStr>(() => todayStr());
  useEffect(() => {
    const refresh = () => setToday((prev) => {
      const next = todayStr();
      return next === prev ? prev : next;
    });
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return today;
}

export const TodayContext = createContext<DateStr>(todayStr());
export const useToday = (): DateStr => useContext(TodayContext);

export function useFmt(): MoneyFormatter {
  const { locale, currency } = useData().settings;
  return useMemo(() => getMoneyFormatter(locale, currency), [locale, currency]);
}

export function useCategoryMap(): Map<string, Category> {
  const { categories } = useData();
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}

export function useExpensesByMonth(): Map<MonthKey, Expense[]> {
  const { expenses } = useData();
  return useMemo(() => groupByMonth(expenses), [expenses]);
}

export function useClassifier(): Classifier {
  const { categories, expenses } = useData();
  return useMemo(() => createClassifier(categories, expenses), [categories, expenses]);
}

export function useIncomesByMonth(): Map<MonthKey, Income[]> {
  const { incomes } = useData();
  return useMemo(() => groupIncomesByMonth(incomes), [incomes]);
}

export function useIncomeSuggester(): IncomeSuggester {
  const { incomes } = useData();
  return useMemo(() => createIncomeSuggester(incomes), [incomes]);
}

/** A typical month's income, from the fixed incomes, what else came in lately, or the rough figure in settings. */
export function useExpectedIncome(): ExpectedIncome {
  const { incomes, incomeRules, settings } = useData();
  const today = useToday();
  return useMemo(() => expectedIncome({ incomes, rules: incomeRules, estimate: settings.monthlyIncome, today }), [incomes, incomeRules, settings.monthlyIncome, today]);
}
