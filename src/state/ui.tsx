import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { monthKeyOf } from '../lib/dates';
import type { MonthKey } from '../lib/types';
import { useToday } from './derived';
import { store } from './store';

export type Tab = 'calc' | 'month' | 'goals' | 'history' | 'settings';

export interface ToastItem {
  id: number;
  text: string;
  /** Smaller second line. */
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'bad';
}

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

export type HapticKind = 'tap' | 'ok' | 'error';

/** What the calculator is filing: money that left, or money that came in. */
export type EntryKind = 'expense' | 'income';

interface ConfirmState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export interface UiApi {
  tab: Tab;
  setTab: (tab: Tab) => void;
  /** Month shown by the Mes and Historial screens. */
  month: MonthKey;
  setMonth: (month: MonthKey) => void;
  /** Which way the last month change went, so the screens can slide the new month in from that side. */
  monthDir: 'prev' | 'next';
  toast: (toast: Omit<ToastItem, 'id'> & { duration?: number }) => void;
  dismissToast: (id: number) => void;
  toasts: ToastItem[];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmState: ConfirmState | null;
  haptic: (kind?: HapticKind) => void;

  expenseId: string | null;
  editExpense: (id: string | null) => void;
  incomeId: string | null;
  editIncome: (id: string | null) => void;
  /** Which kind of entry the calculator is on. */
  entryKind: EntryKind;
  setEntryKind: (kind: EntryKind) => void;
  storyMonth: MonthKey | null;
  openStory: (month: MonthKey | null) => void;
  /** Folder being edited: an id, 'new', or null when closed. */
  folderEdit: string | null;
  editFolder: (id: string | null) => void;
  /** Folder the Historial screen is filtered by (set from the Mes screen). */
  historyFolder: string | null;
  setHistoryFolder: (id: string | null) => void;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside <UiProvider>');
  return ctx;
}

const PATTERNS: Record<HapticKind, number | number[]> = { tap: 8, ok: [10, 40, 16], error: [30, 50, 30] };

export function UiProvider({ children }: { children: ReactNode }) {
  const today = useToday();
  const currentMonth = monthKeyOf(today);

  const [tab, setTab] = useState<Tab>(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    return wanted === 'month' || wanted === 'goals' || wanted === 'history' || wanted === 'settings' ? wanted : 'calc';
  });
  const [month, setMonthRaw] = useState<MonthKey>(currentMonth);
  const [monthDir, setMonthDir] = useState<'prev' | 'next'>('next');
  const setMonth = useCallback(
    (to: MonthKey) => {
      setMonthDir(to < month ? 'prev' : 'next');
      setMonthRaw(to);
    },
    [month],
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [incomeId, setIncomeId] = useState<string | null>(null);
  // The home-screen shortcut "Anotar un ingreso" opens the calculator already on income.
  const [entryKind, setEntryKind] = useState<EntryKind>(() => (new URLSearchParams(window.location.search).get('kind') === 'income' ? 'income' : 'expense'));
  const [storyMonth, setStoryMonth] = useState<MonthKey | null>(null);
  const [folderEdit, setFolderEdit] = useState<string | null>(null);
  const [historyFolder, setHistoryFolder] = useState<string | null>(null);

  // When the calendar rolls over to a new month while the app is open, follow it.
  const lastCurrent = useRef(currentMonth);
  useEffect(() => {
    if (lastCurrent.current !== currentMonth) {
      setMonthRaw((m) => (m === lastCurrent.current ? currentMonth : m));
      lastCurrent.current = currentMonth;
    }
  }, [currentMonth]);

  const nextToastId = useRef(1);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback<UiApi['toast']>(
    ({ duration, ...item }) => {
      const id = nextToastId.current++;
      setToasts((list) => [...list.slice(-2), { ...item, id }]);
      window.setTimeout(() => dismissToast(id), duration ?? (item.actionLabel ? 6000 : 3500));
    },
    [dismissToast],
  );

  const confirm = useCallback<UiApi['confirm']>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({
          options,
          resolve: (ok) => {
            setConfirmState(null);
            resolve(ok);
          },
        });
      }),
    [],
  );

  const haptic = useCallback<UiApi['haptic']>((kind = 'tap') => {
    if (!store.getData().settings.haptics) return;
    try {
      navigator.vibrate?.(PATTERNS[kind]);
    } catch {
      // not supported (iOS): nothing to do
    }
  }, []);

  const api = useMemo<UiApi>(
    () => ({
      tab, setTab, month, setMonth, monthDir, toast, dismissToast, toasts, confirm, confirmState, haptic,
      expenseId, editExpense: setExpenseId, incomeId, editIncome: setIncomeId, entryKind, setEntryKind, storyMonth, openStory: setStoryMonth, folderEdit, editFolder: setFolderEdit,
      historyFolder, setHistoryFolder,
    }),
    [tab, month, setMonth, monthDir, toast, dismissToast, toasts, confirm, confirmState, haptic, expenseId, incomeId, entryKind, storyMonth, folderEdit, historyFolder],
  );

  return <UiContext.Provider value={api}>{children}</UiContext.Provider>;
}
