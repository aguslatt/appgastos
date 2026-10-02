import { useSyncExternalStore } from 'react';
import { AI_CONFIG_KEY, clearAiConfig, readAiConfig, writeAiConfig, type AiConfig } from '../lib/ai/config';
import { browserStorage } from './store';

/*
 * The person's API key and model choice. Kept apart from the app's data (see lib/ai/config.ts):
 * it is never part of a backup, an export or the "everything" that gets wiped with the data.
 */

const storage = browserStorage();
let current: AiConfig | null = readAiConfig(storage);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const aiConfig = {
  get: (): AiConfig | null => current,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** False when the browser would not keep it: the key still works, until the page is closed. */
  save(config: AiConfig): boolean {
    current = config;
    const kept = writeAiConfig(storage, config);
    emit();
    return kept;
  },

  update(patch: Partial<Omit<AiConfig, 'key'>>): void {
    if (current) aiConfig.save({ ...current, ...patch });
  },

  clear(): void {
    current = null;
    clearAiConfig(storage);
    emit();
  },
};

// Another tab connected or disconnected the AI: follow it.
window.addEventListener('storage', (e) => {
  if (e.key !== AI_CONFIG_KEY && e.key !== null) return;
  current = readAiConfig(storage);
  emit();
});

export const useAiConfig = (): AiConfig | null => useSyncExternalStore(aiConfig.subscribe, aiConfig.get);
