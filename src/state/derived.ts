import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createClassifier, type Classifier } from '../lib/classifier';
import { todayStr } from '../lib/dates';
import { getMoneyFormatter, type MoneyFormatter } from '../lib/money';
import { groupByMonth } from '../lib/stats';
import type { Category, DateStr, Expense, MonthKey } from '../lib/types';
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
