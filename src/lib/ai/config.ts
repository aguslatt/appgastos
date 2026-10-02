import type { StorageLike } from '../store';

/*
 * The person's own Anthropic API key. It lives under its own storage key, apart from the app's
 * data, so it can never end up in a backup file, a CSV export or a shared screenshot of settings.
 */
export const AI_CONFIG_KEY = 'mg:ai';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'La más precisa' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Más rápida y barata' },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]['id'];

export const DEFAULT_AI_MODEL: AiModelId = 'claude-opus-5-5';

export interface AiConfig {
  key: string;
  model: AiModelId;
  /** City the person flies from, so flight prices make sense. */
  origin: string;
}

const isModel = (v: unknown): v is AiModelId => AI_MODELS.some((m) => m.id === v);

/** The key without stray spaces or line breaks from copy and paste, or null when it can't be one. */
export function cleanKey(raw: string): string | null {
  const key = raw.trim();
  return /^[\x21-\x7e]{20,300}$/.test(key) ? key : null;
}

export function readAiConfig(storage: StorageLike | null): AiConfig | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AI_CONFIG_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const { key, model, origin } = data as Record<string, unknown>;
    const clean = typeof key === 'string' ? cleanKey(key) : null;
    if (!clean) return null;
    return {
      key: clean,
      model: isModel(model) ? model : DEFAULT_AI_MODEL,
      origin: typeof origin === 'string' ? origin.trim().slice(0, 60) : '',
    };
  } catch {
    return null;
  }
}

/** False when the browser refused to save (the key then only lasts until the page closes). */
export function writeAiConfig(storage: StorageLike | null, config: AiConfig): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function clearAiConfig(storage: StorageLike | null): void {
  try {
    storage?.removeItem(AI_CONFIG_KEY);
  } catch {
    // nothing else to do: the in-memory copy is dropped by the caller
  }
}
