import { addMonths, dateInMonth, dayOf, daysInMonth, monthKeyOf, weekdayMon0 } from './dates';
import type { Category, Cents, DateStr, Expense } from './types';

export type DemoDraft = Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'demo'>;

/** Rough units of each currency per US dollar, only to make sample amounts look plausible. */
const PER_USD: Record<string, number> = {
  ARS: 1500, CLP: 950, COP: 4000, MXN: 18, UYU: 40, PEN: 3.7, BOB: 6.9, PYG: 7500, BRL: 5.4, EUR: 0.92, USD: 1,
  CRC: 510, GTQ: 7.7, DOP: 60,
};

/** Small deterministic random generator so the same sample looks the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rounds to a "price-like" number: 2,980 -> 3,000; 25,430 -> 25,000; 4.3 stays 4.3. */
function nice(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = Math.max(magnitude / 10, 0.1);
  return Math.round(value / step) * step;
}

/**
 * Three full months plus the current one up to `today`, with the usual life: rent,
 * bills, groceries twice a week, coffees, weekend dinners... Enough variety for every
 * screen (calendar, folders, habits, the month story) to have something to say.
 */
export function generateDemo(opts: { today: DateStr; currency: string; categories: readonly Category[]; seed?: number }): DemoDraft[] {
  const rnd = mulberry32(opts.seed ?? 7);
  const perUsd = PER_USD[opts.currency] ?? 1;
  const folderFor = (kind: string): string =>
    opts.categories.find((c) => c.kind === kind && !c.archived)?.id ?? opts.categories.find((c) => c.id === 'otros')?.id ?? 'otros';
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] as T;
  const between = (lo: number, hi: number): number => lo + rnd() * (hi - lo);

  const out: DemoDraft[] = [];
  const currentMonth = monthKeyOf(opts.today);

  for (let month = addMonths(currentMonth, -3); month <= currentMonth; month = addMonths(month, 1)) {
    const lastDay = month === currentMonth ? dayOf(opts.today) : daysInMonth(month);
    // A bit more spending in the current month so "vs last month" has something to say.
    const mood = month === currentMonth ? 1.12 : between(0.92, 1.05);

    const add = (day: number, kind: string, note: string, usd: number) => {
      if (day < 1 || day > lastDay) return;
      const units = nice(usd * perUsd * mood);
      const amount: Cents = Math.round(units * 100);
      if (amount > 0) out.push({ amount, categoryId: folderFor(kind), note, date: dateInMonth(month, day) });
    };
    const fixed = (day: number, kind: string, note: string, usd: number) => {
      if (day > lastDay) return;
      const amount = Math.round(nice(usd * perUsd) * 100);
      out.push({ amount, categoryId: folderFor(kind), note, date: dateInMonth(month, day) });
    };

    fixed(1, 'hogar', 'Alquiler', 330);
    fixed(3, 'salud', 'Gimnasio', 22);
    fixed(5, 'educacion', 'Curso de inglés', 25);
    fixed(7, 'suscripciones', 'Netflix', 8);
    fixed(8, 'mascotas', 'Balanceado', 22);
    fixed(10, 'servicios', 'Luz', 14);
    fixed(11, 'suscripciones', 'Spotify', 5);
    fixed(12, 'servicios', 'Internet', 18);
    fixed(14, 'servicios', 'Celular', 9);
    fixed(18, 'servicios', 'Gas', 8);

    for (let day = 1; day <= lastDay; day++) {
      const weekday = weekdayMon0(dateInMonth(month, day)); // 0 = Monday
      const weekend = weekday >= 5;
      if (rnd() < (weekend ? 0.3 : 0.55)) add(day, 'comida', 'Café', between(1.8, 2.6));
      if (!weekend && rnd() < 0.22) add(day, 'comida', 'Almuerzo', between(8, 13));
      if ((weekday === 2 || weekday === 5) && rnd() < 0.8) add(day, 'super', pick(['Coto', 'Carrefour', 'Verdulería', 'Dietética', 'Carnicería']), between(18, 58));
      if ((weekday === 4 || weekday === 5) && rnd() < 0.65) add(day, 'comida', 'Cena', between(26, 52));
      if (weekday === 6 && rnd() < 0.25) add(day, 'comida', 'Parrilla', between(34, 56));
      if (rnd() < 0.06) add(day, 'comida', 'PedidosYa', between(11, 20));
      if (weekday === 0 && rnd() < 0.8) add(day, 'transporte', 'SUBE', 5);
      if (!weekend && rnd() < 0.16) add(day, 'transporte', 'Uber', between(4, 9));
      if (day % 15 === 4) add(day, 'transporte', 'Nafta', between(22, 30));
      if (rnd() < 0.04) add(day, 'salud', 'Farmacia', between(6, 24));
      if (weekend && rnd() < 0.14) add(day, 'ocio', pick(['Cine', 'Salida', 'Boliche']), between(10, 38));
      if (rnd() < 0.025) add(day, 'compras', pick(['Ropa', 'Mercado Libre', 'Zapatillas']), between(18, 65));
      if (rnd() < 0.02) add(day, 'mascotas', 'Veterinario', between(18, 35));
    }
  }
  return out;
}
