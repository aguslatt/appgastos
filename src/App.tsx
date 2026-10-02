import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ExpenseSheet } from './components/ExpenseSheet';
import { FolderSheet } from './components/FolderSheet';
import { IncomeEntrySheet } from './components/IncomeEntrySheet';
import { Onboarding } from './components/Onboarding';
import { StoryOverlay } from './components/Story';
import { TabBar } from './components/TabBar';
import { Toasts } from './components/Toasts';
import { cx } from './components/cx';
import { CalculatorScreen } from './screens/Calculator';
import { GoalsScreen } from './screens/Goals';
import { HistoryScreen } from './screens/History';
import { MonthScreen } from './screens/Month';
import { SettingsScreen } from './screens/Settings';
import { useAppearance, useViewportHeight } from './state/appearance';
import { TodayContext, useTodayClock } from './state/derived';
import { store, useData, useStoreStatus } from './state/store';
import { UiProvider, useUi, type Tab } from './state/ui';

const SCREENS: Record<Tab, () => React.JSX.Element> = {
  calc: CalculatorScreen,
  month: MonthScreen,
  goals: GoalsScreen,
  history: HistoryScreen,
  settings: SettingsScreen,
};

export default function App() {
  const today = useTodayClock();
  useViewportHeight();

  // Fixed expenses and fixed incomes (a salary) that came due since the last visit.
  useEffect(() => {
    store.runRecurring(today);
    store.runIncomeRules(today);
  }, [today]);

  return (
    <TodayContext.Provider value={today}>
      <UiProvider>
        <Shell />
      </UiProvider>
    </TodayContext.Provider>
  );
}

function Shell() {
  const { tab, toast } = useUi();
  const { settings } = useData();
  const status = useStoreStatus();
  useAppearance(settings.theme, tab);

  // A new version of the app was installed in the background.
  useEffect(() => {
    const onUpdate = () => toast({ text: 'Hay una versión nueva', actionLabel: 'Actualizar', onAction: () => window.location.reload(), duration: 15_000 });
    window.addEventListener('mg:update', onUpdate);
    return () => window.removeEventListener('mg:update', onUpdate);
  }, [toast]);

  // Screens stay mounted once visited, so what you were typing survives a peek at another tab.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  const seen = useRef(visited);
  if (!seen.current.has(tab)) {
    seen.current = new Set(seen.current).add(tab);
    setVisited(seen.current);
  }

  if (!settings.onboarded) {
    return (
      <div className="app">
        <Onboarding />
      </div>
    );
  }

  return (
    <div className="app">
      {!status.persistent && (
        <div className="banner banner--warn" role="alert">
          Este navegador no deja guardar datos: lo que anotes se pierde al cerrar.
        </div>
      )}
      {(Object.keys(SCREENS) as Tab[]).map((id) => {
        const Screen = SCREENS[id];
        return visited.has(id) ? (
          <main key={id} className={cx('screen', id === 'calc' && 'screen--calc')} hidden={tab !== id}>
            <Screen />
          </main>
        ) : null;
      })}
      <TabBar />
      <Toasts />
      <div id="overlay-root" className="overlay-root" />
      <ExpenseSheet />
      <IncomeEntrySheet />
      <FolderSheet />
      <StoryOverlay />
      <ConfirmDialog />
    </div>
  );
}
