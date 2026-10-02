import { normalize } from '../classifier';
import type { Cents, DateStr, MonthKey } from '../types';
import type { TripStyle } from '../trips';
import { jsonObjects, type JsonObject } from './json';
import { AiError, type Confidence } from './types';

/*
 * What is sent: a place or an itinerary, days, people, a month and a currency. Never expenses,
 * income, balances or goals. The builders below take only those fields, so nothing else can leak in.
 */

export const SYSTEM_PROMPT = [
  'You help someone plan a budget inside a personal-finance app. You are asked for a rough, realistic estimate of real-world prices.',
  'If a web search tool is available, use it: find current listings and reputable sources, prefer recent data, and base the numbers on what you find. Never invent a source, and never present a number as found when it is only a guess: when the data is thin, say so with confidence "low".',
  'Reply with ONE JSON object and nothing else: no markdown, no code fences, no text before or after it. Numbers are plain JSON numbers, without currency symbols or thousands separators. Text fields are in neutral Spanish, two short sentences at most.',
].join('\n');

/** A name or place typed by the person, made safe to drop inside a quoted prompt line. */
const inline = (text: string): string => text.replace(/["\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/** "Argentina" from "es-AR", in English for the prompt; null when the locale has no region. */
export function countryName(locale: string): string | null {
  try {
    const region = new Intl.Locale(locale).region;
    return region ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? null) : null;
  } catch {
    return null;
  }
}

// ---- reading what comes back ---------------------------------------------------------------------

const MAX_UNITS = 1_000_000_000_000;

/** A finite number, also accepted when the model wrote it as a plain numeric string. */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};
const inRange = (v: number | null, min: number, max: number): v is number => v !== null && v >= min && v <= max;
const cents = (units: number): Cents => Math.round(units) * 100;
const months = (v: unknown, fallback: number): number => {
  const n = num(v);
  return n === null ? fallback : Math.min(6, Math.max(0, Math.round(n)));
};
const confidence = (v: unknown): Confidence => (v === 'high' || v === 'medium' ? v : 'low');
const note = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '');

/** The last object in the text that reads as a valid answer: models sometimes add a stray snippet after it. */
function pick<T>(text: string, read: (object: JsonObject) => T | null): T {
  for (const object of jsonObjects(text).reverse()) {
    const answer = read(object);
    if (answer !== null) return answer;
  }
  throw new AiError('bad-answer', 'No pude entender la respuesta de la IA. Inténtalo de nuevo.');
}

// ---- moving ------------------------------------------------------------------------------------------

export type HomeSize = 'studio' | '1br' | '2br' | '3br';

export const HOME_LABELS: Record<HomeSize, string> = {
  studio: 'Monoambiente',
  '1br': '1 dormitorio',
  '2br': '2 dormitorios',
  '3br': '3 dormitorios',
};

const HOME_PROMPT: Record<HomeSize, string> = {
  studio: 'a studio, or a one-room apartment',
  '1br': 'an apartment with 1 bedroom',
  '2br': 'an apartment with 2 bedrooms',
  '3br': 'an apartment or house with 3 bedrooms',
};

export interface MoveQuery {
  zone: string;
  home: HomeSize;
  /** ISO code of the app currency: every amount comes back in it. */
  currency: string;
  country: string | null;
  today: DateStr;
}

export function buildMovePrompt(q: MoveQuery): string {
  return [
    `Estimate what it costs to rent a home in "${inline(q.zone)}".`,
    q.country ? `The person lives in ${q.country}.` : '',
    `Home: ${HOME_PROMPT[q.home]}.`,
    `If the place name is ambiguous, pick the most likely one for someone who uses ${q.currency}, and say which in the notes.`,
    `Every amount is in ${q.currency}, whole units, for one month (not thousands). Today is ${q.today}.`,
    'Search for current rental listings and local market reports for that exact area, then answer with this JSON object:',
    '{',
    '  "rent": typical monthly rent for that home: the middle of the market, not the cheapest listing,',
    '  "rentLow": monthly rent at the cheaper end of normal listings,',
    '  "rentHigh": monthly rent at the pricier end of normal listings,',
    '  "monthlyExtras": typical monthly building fees plus utilities (electricity, gas, water, internet),',
    '  "depositMonths": security deposit, in months of rent, as is usual there,',
    '  "commissionMonths": agent fee, in months of rent (0 when the owner usually pays it),',
    '  "advanceMonths": rent paid in advance when signing, in months,',
    '  "confidence": "low", "medium" or "high", by how solid the data you found is,',
    '  "notes": what the numbers are based on and anything worth knowing',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface MoveAnswer {
  rent: Cents;
  rentLow: Cents;
  rentHigh: Cents;
  monthlyExtras: Cents;
  depositMonths: number;
  commissionMonths: number;
  advanceMonths: number;
  confidence: Confidence;
  notes: string;
}

function readMove(o: JsonObject): MoveAnswer | null {
  const rent = num(o.rent);
  if (!inRange(rent, 1, MAX_UNITS)) return null;
  const low = num(o.rentLow);
  const high = num(o.rentHigh);
  const extras = num(o.monthlyExtras);
  return {
    rent: cents(rent),
    // The range always brackets the typical rent, whatever order the model wrote them in.
    rentLow: cents(inRange(low, 1, MAX_UNITS) ? Math.min(low, rent) : rent),
    rentHigh: cents(inRange(high, 1, MAX_UNITS) ? Math.max(high, rent) : rent),
    monthlyExtras: inRange(extras, 0, MAX_UNITS) ? cents(extras) : 0,
    depositMonths: months(o.depositMonths, 1),
    commissionMonths: months(o.commissionMonths, 1),
    advanceMonths: months(o.advanceMonths, 1),
    confidence: confidence(o.confidence),
    notes: note(o.notes),
  };
}

export const parseMoveAnswer = (text: string): MoveAnswer => pick(text, readMove);

// ---- trips -----------------------------------------------------------------------------------------------

const STYLE_PROMPT: Record<TripStyle, string> = {
  budget: 'budget (hostels or basic private rooms, cheap local food, public transport)',
  mid: 'mid-range (comfortable hotels or good apartments, a mix of restaurants, a few paid activities)',
  comfort: 'comfortable (4-star hotels, good restaurants, taxis, paid experiences)',
};

export interface TripQuery {
  stops: ReadonlyArray<{ place: string; days: number }>;
  people: number;
  style: TripStyle;
  /** City the person flies from, as they wrote it; may be empty. */
  origin: string;
  country: string | null;
  /** The local currency, only to place the traveller: prices come back in dollars. */
  currency: string;
  month: MonthKey;
  today: DateStr;
}

export function buildTripPrompt(q: TripQuery): string {
  const origin = inline(q.origin);
  const from = origin ? `${origin}${q.country ? `, ${q.country}` : ''}` : (q.country ?? `a city where ${q.currency} is the local currency`);
  return [
    'Estimate what a trip costs, in US dollars.',
    `Travellers: ${q.people} ${q.people === 1 ? 'person' : 'people'}, flying from ${from}.`,
    `Travel month: ${q.month} (use that season's prices). Today is ${q.today}.`,
    `Style: ${STYLE_PROMPT[q.style]}.`,
    'Itinerary, in order:',
    ...q.stops.map((s, i) => `${i + 1}. ${inline(s.place)}, ${s.days} ${s.days === 1 ? 'day' : 'days'}`),
    'Search for current prices (flights from the departure city, lodging, food and local transport in each place), then answer with this JSON object:',
    '{',
    '  "flightPerPerson": round-trip economy flight per person for that route and month, in USD,',
    '  "hopPerPerson": average cost per person of ONE transfer between consecutive stops (train, bus or low-cost flight), in USD; 0 when there is a single stop,',
    '  "stops": [ one entry per stop, in the same order: { "place": the name as written above, "dailyPerPerson": USD per person per day there, covering lodging (a shared room), food, local transport and a couple of activities, without flights } ],',
    '  "confidence": "low", "medium" or "high", by how solid the data you found is,',
    '  "notes": what drives the number and anything worth knowing, such as the season',
    '}',
  ].join('\n');
}

export interface TripAnswer {
  /** Round-trip flight per person, whole USD. */
  flightUsd: number;
  /** One transfer between stops per person, whole USD; null when the answer didn't say. */
  hopUsd: number | null;
  /** Per person per day for each asked stop, in the same order; null where the answer had no usable price. */
  daily: Array<number | null>;
  confidence: Confidence;
  notes: string;
}

function readTrip(o: JsonObject, asked: ReadonlyArray<{ place: string }>): TripAnswer | null {
  const flight = num(o.flightPerPerson);
  if (!inRange(flight, 30, 30_000)) return null;
  const hop = num(o.hopPerPerson);

  const entries = (Array.isArray(o.stops) ? o.stops : []).filter((e): e is JsonObject => typeof e === 'object' && e !== null && !Array.isArray(e));
  const daily = asked.map((stop, i) => {
    // By name first (the model may reorder or drop one), by position when the counts line up.
    const entry = entries.find((e) => typeof e.place === 'string' && normalize(e.place) === normalize(stop.place)) ?? (entries.length === asked.length ? entries[i] : undefined);
    const value = num(entry?.dailyPerPerson);
    return inRange(value, 5, 3_000) ? Math.round(value) : null;
  });

  return {
    flightUsd: Math.round(flight),
    hopUsd: inRange(hop, 0, 5_000) ? Math.round(hop) : null,
    daily,
    confidence: confidence(o.confidence),
    notes: note(o.notes),
  };
}

export const parseTripAnswer = (text: string, asked: ReadonlyArray<{ place: string }>): TripAnswer => pick(text, (o) => readTrip(o, asked));
