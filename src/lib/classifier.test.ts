import { describe, expect, it } from 'vitest';
import { contentKey, createClassifier, dictionaryConflicts, guessKind, normalize } from './classifier';
import { defaultCategories } from './categories';
import { KEYWORDS } from './keywords';
import type { Category, Expense } from './types';

const defaults = defaultCategories();
let counter = 0;
const expense = (note: string, categoryId: string): Expense => ({
  id: `e${counter++}`,
  amount: 100_00,
  categoryId,
  note,
  date: '2026-09-15',
  createdAt: 1_700_000_000_000 + counter,
  updatedAt: 1_700_000_000_000 + counter,
});
const fresh = (categories: Category[] = defaults, expenses: Expense[] = []) => createClassifier(categories, expenses);
const folderOf = (text: string, c = fresh()) => c.suggest(text)?.categoryId ?? null;

describe('normalize / contentKey', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalize('  Café, con  LECHE!! ')).toBe('cafe con leche');
    expect(normalize('Cumpleaños')).toBe('cumpleanos');
  });

  it('drops filler words and folds plurals', () => {
    expect(contentKey('Cafés de la esquina')).toBe(contentKey('cafe esquina'));
    expect(contentKey('Uber 4500')).toBe('uber');
  });
});

describe('dictionary', () => {
  it('has no word filed under two kinds', () => {
    expect(dictionaryConflicts()).toEqual([]);
  });

  it('covers every default folder', () => {
    for (const c of defaults) expect(KEYWORDS[c.kind ?? ''], c.id).toBeTruthy();
  });
});

describe('guessing from words (no history)', () => {
  it.each([
    ['propina', 'comida'],
    ['Propina 10%', 'comida'],
    ['uber', 'transporte'],
    ['uber eats', 'comida'],
    ['pedidos ya', 'comida'],
    ['coto', 'super'],
    ['verdulería', 'super'],
    ['farmacia', 'salud'],
    ['netflix', 'suscripciones'],
    ['luz', 'servicios'],
    ['factura de gas', 'servicios'],
    ['alquiler', 'hogar'],
    ['expensas', 'hogar'],
    ['cine', 'ocio'],
    ['zapatillas', 'compras'],
    ['veterinario', 'mascotas'],
    ['curso de inglés', 'educacion'],
    ['nafta', 'transporte'],
    ['carga sube', 'transporte'],
    ['birra con amigos', 'comida'],
    ['cafés', 'comida'],
    ['colectivos', 'transporte'],
    ['bares', 'comida'],
    ['pantalones', 'compras'],
    ['mercado libre', 'compras'],
    ['cuota casa', 'hogar'],
    ['otros', 'otros'],
  ])('"%s" -> %s', (text, folder) => {
    expect(folderOf(text)).toBe(folder);
  });

  it('is confident about clear single words', () => {
    expect(fresh().suggest('propina')).toMatchObject({ confidence: 'high', source: 'keyword' });
    expect(fresh().suggest('uber eats')).toMatchObject({ confidence: 'high' });
  });

  it('returns nothing when it has no idea', () => {
    expect(fresh().suggest('xyzqw')).toBeNull();
    expect(fresh().suggest('')).toBeNull();
    expect(fresh().suggest('de la')).toBeNull();
    expect(fresh().suggest('4500')).toBeNull();
  });
});

describe('typos and half-typed words', () => {
  it('forgives typos', () => {
    expect(folderOf('farmasia')).toBe('salud');
    expect(folderOf('supermecado')).toBe('super');
    expect(folderOf('restaurnte')).toBe('comida');
    expect(folderOf('nafat')).toBe('transporte'); // swapped letters
    expect(fresh().suggest('farmasia')).toMatchObject({ source: 'similar' });
  });

  it('guesses while the word is still being typed, with low confidence', () => {
    const s = fresh().suggest('farm');
    expect(s?.categoryId).toBe('salud');
    expect(s?.confidence).toBe('low');
  });

  it('does not match short words by accident', () => {
    expect(folderOf('lu')).toBeNull();
    expect(folderOf('abc')).toBeNull();
  });
});

describe('folder names', () => {
  const gym: Category = { id: 'gym', name: 'Gimnasio', emoji: '🏋️', color: 'red', flexible: true, limit: null, archived: false };

  it('prefers a folder named like the text over the dictionary', () => {
    const c = fresh([...defaults, gym]);
    expect(folderOf('gimnasio', c)).toBe('gym');
    expect(c.suggest('gimnasio')?.source).toBe('name');
  });

  it('matches custom folders the dictionary knows nothing about', () => {
    const trips: Category = { id: 'trip', name: 'Viaje a Brasil', emoji: '✈️', color: 'sky', flexible: true, limit: null, archived: false };
    expect(folderOf('brasil', fresh([...defaults, trips]))).toBe('trip');
  });

  it('never suggests an archived folder', () => {
    const archived = defaults.map((c) => (c.id === 'salud' ? { ...c, archived: true } : c));
    expect(folderOf('farmacia', fresh(archived))).toBeNull();
  });
});

describe('learning from the user', () => {
  it('remembers where an exact text was filed', () => {
    const c = fresh(defaults, [expense('tito', 'ocio')]);
    expect(c.suggest('Tito')).toMatchObject({ categoryId: 'ocio', source: 'history', confidence: 'high' });
  });

  it('flips the dictionary after two consistent corrections, not after one', () => {
    const once = fresh(defaults, [expense('kiosco de la esquina', 'otros')]);
    expect(folderOf('kiosco', once)).toBe('comida');
    const twice = fresh(defaults, [expense('kiosco de la esquina', 'otros'), expense('kiosco don pepe', 'otros')]);
    expect(folderOf('kiosco', twice)).toBe('otros');
  });

  it('follows the folder the user filed most often', () => {
    const history = [
      expense('club', 'ocio'),
      expense('club', 'ocio'),
      expense('club', 'otros'),
    ];
    expect(folderOf('club', fresh(defaults, history))).toBe('ocio');
  });

  it('learns brand-new words from the first letters', () => {
    const history = [expense('lo de marta', 'comida'), expense('lo de marta', 'comida')];
    expect(folderOf('mart', fresh(defaults, history))).toBe('comida');
  });

  it('ignores history that points at an archived folder', () => {
    const archived = defaults.map((c) => (c.id === 'ocio' ? { ...c, archived: true } : c));
    expect(folderOf('tito', fresh(archived, [expense('tito', 'ocio')]))).toBeNull();
  });
});

describe('guessKind', () => {
  it('reads the kind of expense out of a folder name', () => {
    expect(guessKind('Restaurantes')).toBe('comida');
    expect(guessKind('Super chino')).toBe('super');
    expect(guessKind('Mi gimnasio')).toBe('salud');
    expect(guessKind('Netflix y cia')).toBe('suscripciones');
  });

  it('returns null when the name says nothing', () => {
    expect(guessKind('Viaje a Brasil')).toBeNull();
    expect(guessKind('')).toBeNull();
  });
});
