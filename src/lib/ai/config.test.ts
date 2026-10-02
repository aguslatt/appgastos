import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../store';
import { AI_CONFIG_KEY, AI_MODELS, DEFAULT_AI_MODEL, cleanKey, clearAiConfig, readAiConfig, writeAiConfig, type AiConfig } from './config';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

function memory(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

describe('cleanKey', () => {
  it('accepts a key as it is', () => {
    expect(cleanKey(KEY)).toBe(KEY);
  });

  it('drops the spaces and line breaks that come with copy and paste', () => {
    expect(cleanKey(`  ${KEY}\n`)).toBe(KEY);
    expect(cleanKey(`\t${KEY} \r\n`)).toBe(KEY);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too short', 'sk-ant-123'],
    ['a space inside', 'sk-ant-api03-abcdefghij klmnopqrstuvwxyz'],
    ['a line break inside', 'sk-ant-api03-abcdefghij\nklmnopqrstuvwxyz'],
    ['non-ASCII characters', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-ñ'],
    ['an emoji', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-😀'],
    ['too long', `sk-ant-${'a'.repeat(400)}`],
  ])('rejects a key that is %s', (_name, raw) => {
    expect(cleanKey(raw)).toBeNull();
  });
});

describe('saved configuration', () => {
  const config: AiConfig = { key: KEY, model: 'claude-sonnet-5-5', origin: 'Buenos Aires' };

  it('is kept under its own storage key, not with the app data', () => {
    expect(AI_CONFIG_KEY).not.toBe('mg:data:v1');
    const storage = memory();
    expect(writeAiConfig(storage, config)).toBe(true);
    expect([...storage.map.keys()]).toEqual([AI_CONFIG_KEY]);
  });

  it('comes back as it was saved', () => {
    const storage = memory();
    writeAiConfig(storage, config);
    expect(readAiConfig(storage)).toEqual(config);
  });

  it('is empty before anything is saved', () => {
    expect(readAiConfig(memory())).toBeNull();
  });

  it('is gone after clearing', () => {
    const storage = memory();
    writeAiConfig(storage, config);
    clearAiConfig(storage);
    expect(readAiConfig(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it.each([
    ['not JSON', 'sk-ant-whatever'],
    ['a JSON string', '"hola"'],
    ['null', 'null'],
    ['an array', '[1,2]'],
    ['an object without a key', '{"model":"claude-opus-5-5"}'],
    ['an object with a key that cannot be one', '{"key":"x"}'],
    ['an object with a key of the wrong type', '{"key":12345678901234567890}'],
  ])('treats %s as nothing saved', (_name, raw) => {
    expect(readAiConfig(memory({ [AI_CONFIG_KEY]: raw }))).toBeNull();
  });

  it('falls back to the default model when the saved one is not offered any more', () => {
    const storage = memory({ [AI_CONFIG_KEY]: JSON.stringify({ key: KEY, model: 'claude-old-1', origin: '' }) });
    expect(readAiConfig(storage)?.model).toBe(DEFAULT_AI_MODEL);
  });

  it('cleans up the key and the origin it reads', () => {
    const storage = memory({ [AI_CONFIG_KEY]: JSON.stringify({ key: ` ${KEY}\n`, model: 'claude-opus-5-5', origin: `  ${'x'.repeat(100)}  ` }) });
    const read = readAiConfig(storage);
    expect(read?.key).toBe(KEY);
    expect(read?.origin).toBe('x'.repeat(60));
  });

  it('defaults a missing or odd origin to empty', () => {
    expect(readAiConfig(memory({ [AI_CONFIG_KEY]: JSON.stringify({ key: KEY, model: 'claude-opus-5-5' }) }))?.origin).toBe('');
    expect(readAiConfig(memory({ [AI_CONFIG_KEY]: JSON.stringify({ key: KEY, model: 'claude-opus-5-5', origin: 5 }) }))?.origin).toBe('');
  });

  it('does not throw when the browser blocks storage', () => {
    expect(readAiConfig(throwing)).toBeNull();
    expect(writeAiConfig(throwing, config)).toBe(false);
    expect(() => clearAiConfig(throwing)).not.toThrow();
  });

  it('does nothing without storage', () => {
    expect(readAiConfig(null)).toBeNull();
    expect(writeAiConfig(null, config)).toBe(false);
    expect(() => clearAiConfig(null)).not.toThrow();
  });
});

describe('models', () => {
  it('offers the default one', () => {
    expect(AI_MODELS.map((m) => m.id)).toContain(DEFAULT_AI_MODEL);
  });

  it('has a label and a hint for each', () => {
    for (const model of AI_MODELS) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.hint.length).toBeGreaterThan(0);
    }
  });
});
