import { useSyncExternalStore } from 'react';
import { DATA_KEY, createStore, type StorageLike, type StoreStatus } from '../lib/store';
import type { AppData } from '../lib/types';

/** localStorage when the browser allows it (private modes and strict settings may not). */
export function browserStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__mg_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export const store = createStore({ storage: browserStorage(), language: navigator.language });

// Another tab or window changed the data: pick it up.
window.addEventListener('storage', (e) => {
  if (e.key === DATA_KEY || e.key === null) store.reload();
});

export const useData = (): AppData => useSyncExternalStore(store.subscribe, store.getData);
export const useStoreStatus = (): StoreStatus => useSyncExternalStore(store.subscribe, store.getStatus);
