/** Money is stored as integer minor units ("cents") to avoid float drift when summing. */
export type Cents = number;
/** Local calendar date, `YYYY-MM-DD`. Never a timestamp, so time zones can't shift a day. */
export type DateStr = string;
/** `YYYY-MM`. */
export type MonthKey = string;

export type ThemePref = 'system' | 'light' | 'dark';

export interface Category {
  id: string;
  name: string;
  emoji: string;
  /** Key into the category palette (see `categories.ts`). */
  color: string;
  /** Semantic type the folder-guessing AI understands; custom folders may omit it. */
  kind?: string;
  /** Discretionary spending; the monthly summary suggests trimming these first. */
  flexible: boolean;
  /** Optional monthly limit for this folder. */
  limit: Cents | null;
  /** Hidden from the picker but kept so past expenses still resolve. */
  archived: boolean;
}

export interface Expense {
  id: string;
  amount: Cents;
  categoryId: string;
  note: string;
  date: DateStr;
  createdAt: number;
  updatedAt: number;
  /** Set when the expense was generated from a recurring rule. */
  recurringId?: string;
  /** Sample data, removable without touching real entries. */
  demo?: boolean;
}

/** A monthly fixed expense (rent, subscriptions...). */
export interface Recurring {
  id: string;
  amount: Cents;
  categoryId: string;
  note: string;
  /** Day of the month, 1-31 (clamped to the month's length). */
  day: number;
  /** First month the rule applies to. */
  startMonth: MonthKey;
  /** Last month already generated (or deliberately skipped). */
  lastGenerated: MonthKey | null;
  active: boolean;
}

export type GoalKind = 'trip' | 'move' | 'saving';

export interface TripPlan {
  stops: Array<{ place: string; days: number }>;
  people: number;
  style: 'budget' | 'mid' | 'comfort';
  /** Units of the app currency per US dollar used for the estimate. */
  fx?: number;
  /** Real flight price per person, when known (overrides the reference). */
  flightEach?: Cents;
  extras?: Cents;
}

export interface MovePlan {
  zone: string;
  rent: Cents;
  /** Building fees and utilities, monthly. */
  monthlyExtras: Cents;
  depositMonths: number;
  commissionMonths: number;
  advanceMonths: number;
  /** One-off: truck, furniture, small repairs. */
  setup: Cents;
  /** What the current home costs per month (rent plus extras), to measure the change. */
  currentMonthly: Cents;
}

export interface Goal {
  id: string;
  kind: GoalKind;
  name: string;
  emoji: string;
  /** Total to have set aside by the deadline. */
  target: Cents;
  /** Month by which the money is needed. */
  deadline: MonthKey;
  /** Already set aside. */
  saved: Cents;
  createdAt: number;
  trip?: TripPlan;
  move?: MovePlan;
}

export interface Settings {
  currency: string;
  locale: string;
  monthlyBudget: Cents | null;
  /** Optional; only used to express a purchase as hours of work. */
  monthlyIncome: Cents | null;
  /** Units of the app currency per US dollar; used to price trips quoted in dollars. */
  fxRate: number | null;
  theme: ThemePref;
  haptics: boolean;
  onboarded: boolean;
}

export interface AppData {
  version: 1;
  expenses: Expense[];
  categories: Category[];
  recurring: Recurring[];
  goals: Goal[];
  settings: Settings;
}
