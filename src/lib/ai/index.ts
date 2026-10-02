import type { AiModelId } from './config';
import { describeError } from './errors';
import {
  SYSTEM_PROMPT,
  buildMovePrompt,
  buildTripPrompt,
  parseMoveAnswer,
  parseTripAnswer,
  type MoveAnswer,
  type MoveQuery,
  type TripAnswer,
  type TripQuery,
} from './prompts';
import { runAi, type ClientLike } from './run';
import type { AiProgress, AiSource } from './types';

export type { AiConfig, AiModelId } from './config';
export { AI_MODELS, DEFAULT_AI_MODEL, cleanKey } from './config';
export { HOME_LABELS, countryName, type HomeSize, type MoveAnswer, type MoveQuery, type TripAnswer, type TripQuery } from './prompts';
export { AiError, type AiErrorCode, type AiProgress, type AiSource, type Confidence } from './types';

export interface AiContext {
  key: string;
  model: AiModelId;
  signal?: AbortSignal;
  onProgress?: (progress: AiProgress) => void;
  /** Tests hand in a stand-in; the app builds the real client the first time it is needed. */
  client?: ClientLike;
}

export interface Sourced {
  sources: AiSource[];
  /** False when the answer comes from what the model already knew, not from searching the web. */
  live: boolean;
}

/**
 * The SDK is only loaded when someone actually uses the AI, so the app opens just as fast without it.
 * `dangerouslyAllowBrowser` exists because a key embedded in a public website is dangerous; here the
 * key is the visitor's own, typed by them and kept on their device, which is the case it is meant for.
 */
async function createClient(key: string): Promise<ClientLike> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 240_000 });
}

async function withClient<T>(ctx: AiContext, job: (client: ClientLike) => Promise<T>): Promise<T> {
  try {
    return await job(ctx.client ?? (await createClient(ctx.key)));
  } catch (err) {
    throw await describeError(err, ctx.signal);
  }
}

export type MoveResult = MoveAnswer & Sourced;
export type TripResult = TripAnswer & Sourced;

/** Looks up what renting costs in a place: rent, building fees and what it takes to move in. */
export function estimateMove(query: MoveQuery, ctx: AiContext): Promise<MoveResult> {
  return withClient(ctx, async (client) => {
    const run = await runAi({ client, model: ctx.model, system: SYSTEM_PROMPT, prompt: buildMovePrompt(query), search: true, signal: ctx.signal, onProgress: ctx.onProgress });
    return { ...parseMoveAnswer(run.text), sources: run.sources, live: run.live };
  });
}

/** Looks up current prices for a trip: the flight, a day in each place and the transfers between them. */
export function estimateTripPrices(query: TripQuery, ctx: AiContext): Promise<TripResult> {
  return withClient(ctx, async (client) => {
    const run = await runAi({ client, model: ctx.model, system: SYSTEM_PROMPT, prompt: buildTripPrompt(query), search: true, signal: ctx.signal, onProgress: ctx.onProgress });
    return { ...parseTripAnswer(run.text, query.stops), sources: run.sources, live: run.live };
  });
}

/** Asks Anthropic about the model with this key: free, and fails with a readable error when the key is wrong. */
export function checkKey(key: string, model: AiModelId, signal?: AbortSignal, client?: ClientLike): Promise<void> {
  return withClient({ key, model, signal, client }, async (c) => {
    await c.models.retrieve(model, null, { signal });
  });
}
