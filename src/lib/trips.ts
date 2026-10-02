import { normalize } from './classifier';
import type { Cents } from './types';

/*
 * Rough reference costs to get a first number for a trip. They are ballpark figures in
 * US dollars (2026), per person per day, covering a double room shared by two, three
 * meals, local transport and a couple of paid activities. Real prices swing a lot with
 * the season and the exact dates, so the app shows them as editable estimates, never as facts.
 */

export type TripStyle = 'budget' | 'mid' | 'comfort';
export type Region = 'europe' | 'usa' | 'caribbean' | 'brazil' | 'southcone' | 'andes' | 'asia' | 'oceania' | 'mideast';

export interface Place {
  id: string;
  name: string;
  region: Region;
  /** USD per person per day: [budget, mid, comfort]. */
  daily: readonly [number, number, number];
  /** Other ways it may be written, for the search box. */
  aliases?: readonly string[];
}

const p = (id: string, name: string, region: Region, budget: number, mid: number, comfort: number, aliases: string[] = []): Place => ({
  id, name, region, daily: [budget, mid, comfort], aliases,
});

export const PLACES: readonly Place[] = [
  // Europe
  p('madrid', 'Madrid', 'europe', 70, 120, 220), p('barcelona', 'Barcelona', 'europe', 80, 135, 240), p('sevilla', 'Sevilla', 'europe', 60, 105, 190),
  p('lisboa', 'Lisboa', 'europe', 65, 110, 200, ['lisbon']), p('oporto', 'Oporto', 'europe', 55, 95, 170, ['porto']),
  p('paris', 'París', 'europe', 100, 175, 320), p('roma', 'Roma', 'europe', 90, 155, 290, ['rome']), p('florencia', 'Florencia', 'europe', 85, 150, 270, ['florence']),
  p('venecia', 'Venecia', 'europe', 100, 175, 310, ['venice']), p('milan', 'Milán', 'europe', 90, 160, 290, ['milano']),
  p('amsterdam', 'Ámsterdam', 'europe', 100, 175, 310), p('berlin', 'Berlín', 'europe', 70, 120, 220), p('munich', 'Múnich', 'europe', 85, 145, 260),
  p('viena', 'Viena', 'europe', 80, 140, 250, ['vienna']), p('praga', 'Praga', 'europe', 55, 95, 170, ['prague']), p('budapest', 'Budapest', 'europe', 50, 90, 160),
  p('atenas', 'Atenas', 'europe', 60, 105, 190, ['athens']), p('londres', 'Londres', 'europe', 110, 190, 340, ['london']), p('dublin', 'Dublín', 'europe', 100, 170, 300),
  p('copenhague', 'Copenhague', 'europe', 115, 195, 340), p('estocolmo', 'Estocolmo', 'europe', 100, 170, 300), p('zurich', 'Zúrich', 'europe', 140, 230, 400),
  p('estambul', 'Estambul', 'europe', 50, 90, 170, ['istanbul']),
  // United States
  p('nueva-york', 'Nueva York', 'usa', 150, 260, 450, ['new york', 'nyc']), p('miami', 'Miami', 'usa', 120, 210, 380),
  p('orlando', 'Orlando', 'usa', 130, 230, 400, ['disney']), p('los-angeles', 'Los Ángeles', 'usa', 130, 230, 400, ['la']), p('las-vegas', 'Las Vegas', 'usa', 100, 180, 330),
  // Caribbean and Mexico
  p('cancun', 'Cancún', 'caribbean', 80, 150, 300), p('punta-cana', 'Punta Cana', 'caribbean', 90, 170, 330), p('ciudad-de-mexico', 'Ciudad de México', 'caribbean', 45, 85, 170, ['cdmx', 'mexico df']),
  p('cartagena', 'Cartagena', 'caribbean', 55, 95, 180),
  // Brazil
  p('rio', 'Río de Janeiro', 'brazil', 50, 90, 170, ['rio de janeiro']), p('florianopolis', 'Florianópolis', 'brazil', 50, 90, 160, ['floripa']), p('salvador', 'Salvador de Bahía', 'brazil', 45, 80, 150, ['bahia']),
  // Southern cone (close to Argentina)
  p('santiago', 'Santiago de Chile', 'southcone', 55, 95, 170), p('montevideo', 'Montevideo', 'southcone', 55, 95, 180), p('punta-del-este', 'Punta del Este', 'southcone', 70, 130, 260),
  p('bariloche', 'Bariloche', 'southcone', 55, 100, 190), p('mendoza', 'Mendoza', 'southcone', 45, 85, 160),
  // Andes
  p('lima', 'Lima', 'andes', 40, 75, 150), p('cusco', 'Cusco', 'andes', 40, 70, 140, ['machu picchu']), p('bogota', 'Bogotá', 'andes', 40, 75, 150), p('medellin', 'Medellín', 'andes', 40, 70, 140),
  // Asia, Oceania, Middle East
  p('tokio', 'Tokio', 'asia', 70, 130, 250, ['tokyo']), p('bangkok', 'Bangkok', 'asia', 35, 65, 130), p('bali', 'Bali', 'asia', 35, 70, 150),
  p('sidney', 'Sídney', 'oceania', 110, 190, 330, ['sydney']), p('dubai', 'Dubái', 'mideast', 100, 180, 350), p('el-cairo', 'El Cairo', 'mideast', 40, 75, 150, ['cairo']),
];

/** Round-trip flight per person from South America, USD, economy, typical. */
export const FLIGHT_USD: Record<Region, number> = {
  europe: 1100, usa: 950, caribbean: 800, brazil: 420, southcone: 250, andes: 600, asia: 1800, oceania: 2200, mideast: 1500,
};

/** Cost of each hop between stops in the same trip (trains, low-cost flights...), USD per person. */
const HOP_USD: Record<Region, number> = {
  europe: 60, usa: 150, caribbean: 120, brazil: 90, southcone: 60, andes: 100, asia: 120, oceania: 150, mideast: 120,
};

export const STYLE_LABELS: Record<TripStyle, string> = { budget: 'Económico', mid: 'Medio', comfort: 'Cómodo' };
const STYLE_INDEX: Record<TripStyle, 0 | 1 | 2> = { budget: 0, mid: 1, comfort: 2 };

/** Places matching what's being typed (accent and case insensitive), best matches first. */
export function searchPlaces(query: string, limit = 5): Place[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const score = (place: Place): number => {
    const names = [place.name, ...(place.aliases ?? [])].map(normalize);
    if (names.some((n) => n === q)) return 3;
    if (names.some((n) => n.startsWith(q))) return 2;
    if (names.some((n) => n.split(' ').some((w) => w.startsWith(q)) || n.includes(q))) return 1;
    return 0;
  };
  return PLACES.map((place) => ({ place, s: score(place) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((x) => x.place);
}

export function findPlace(name: string): Place | undefined {
  const q = normalize(name);
  return PLACES.find((place) => [place.name, ...(place.aliases ?? [])].some((n) => normalize(n) === q));
}

export interface TripEstimateInput {
  stops: ReadonlyArray<{ place: string; days: number }>;
  people: number;
  style: TripStyle;
  /** USD to local currency; use 1 when the app currency is USD. */
  fxRate: number;
  /** Overrides the reference flight price (local currency, per person). */
  flightEach?: Cents | null;
  /** Shopping, gifts, anything else (local currency). */
  extras?: Cents;
  /** Margin for the unexpected, 0..1. */
  buffer?: number;
}

export interface TripLine {
  id: 'flights' | 'stay' | 'hops' | 'extras' | 'buffer';
  label: string;
  amount: Cents;
}

export interface TripEstimate {
  lines: TripLine[];
  total: Cents;
  /** Stops that weren't in the reference table, priced at the regional average. */
  unknown: string[];
  days: number;
}

const average = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

/** A first number for a trip: flights + daily costs + hops between stops + extras + a margin. */
export function estimateTrip(input: TripEstimateInput): TripEstimate {
  const people = Math.max(1, Math.round(input.people));
  const fx = input.fxRate > 0 ? input.fxRate : 1;
  const idx = STYLE_INDEX[input.style];
  const unknown: string[] = [];
  const regions: Region[] = [];
  let stayUsd = 0;
  let days = 0;

  for (const stop of input.stops) {
    const d = Math.max(0, Math.round(stop.days));
    if (d === 0) continue;
    days += d;
    const place = findPlace(stop.place);
    if (place) {
      regions.push(place.region);
      stayUsd += (place.daily[idx] ?? 0) * d * people;
    } else {
      // Unknown place: average of everything we know, so the number is at least in the right range.
      if (stop.place.trim()) unknown.push(stop.place.trim());
      stayUsd += average(PLACES.map((x) => x.daily[idx] ?? 0)) * d * people;
    }
  }

  // One flight price for the trip: the most expensive region visited.
  const flightRegion = regions.reduce<Region | null>((best, r) => (best === null || FLIGHT_USD[r] > FLIGHT_USD[best] ? r : best), null);
  const flightEach = input.flightEach ?? Math.round((flightRegion ? FLIGHT_USD[flightRegion] : average(Object.values(FLIGHT_USD))) * fx * 100);
  const flights = flightEach * people;

  const stops = input.stops.filter((s) => s.days > 0);
  const hopRegion = regions[0];
  const hops = Math.round(Math.max(0, stops.length - 1) * (hopRegion ? HOP_USD[hopRegion] : 100) * people * fx * 100);

  const stay = Math.round(stayUsd * fx * 100);
  const extras = input.extras ?? 0;
  const subtotal = flights + stay + hops + extras;
  const buffer = Math.round(subtotal * Math.min(1, Math.max(0, input.buffer ?? 0.1)));

  const lines: TripLine[] = [
    { id: 'flights', label: `Pasajes (${people} ${people === 1 ? 'persona' : 'personas'})`, amount: flights },
    { id: 'stay', label: `Alojamiento, comida y salidas (${days} ${days === 1 ? 'día' : 'días'})`, amount: stay },
    ...(hops > 0 ? [{ id: 'hops' as const, label: 'Traslados entre ciudades', amount: hops }] : []),
    ...(extras > 0 ? [{ id: 'extras' as const, label: 'Compras y extras', amount: extras }] : []),
    { id: 'buffer', label: 'Margen para imprevistos', amount: buffer },
  ];
  return { lines, total: subtotal + buffer, unknown, days };
}
