import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AiError, checkKey, estimateMove, estimateTripPrices, type MoveQuery, type TripQuery } from './index';
import type { ClientLike } from './run';

type Block = Anthropic.ContentBlock;

const text = (t: string): Block => ({ type: 'text', text: t, citations: null }) as unknown as Block;
const results = (list: Array<{ url: string; title: string }>): Block =>
  ({ type: 'web_search_tool_result', tool_use_id: 's1', caller: { type: 'direct' }, content: list.map((r) => ({ type: 'web_search_result', encrypted_content: 'e', page_age: null, ...r })) }) as unknown as Block;

/** A client whose requests answer from a list, in order; an Error is thrown instead of answering. */
function fakeClient(turns: Array<Block[] | Error>) {
  const queue = [...turns];
  const requests: Anthropic.MessageStreamParams[] = [];
  const retrieved: Array<{ model: string; params: unknown }> = [];
  const client: ClientLike = {
    messages: {
      stream(params) {
        requests.push(structuredClone(params));
        const turn = queue.shift();
        return {
          on() {
            return this;
          },
          async finalMessage() {
            if (!turn) throw new Error('the fake ran out of answers');
            if (turn instanceof Error) throw turn;
            return { content: turn, stop_reason: 'end_turn' } as unknown as Anthropic.Message;
          },
        };
      },
    },
    models: {
      async retrieve(model, params) {
        retrieved.push({ model, params });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return {};
      },
    },
  };
  return { client, requests, retrieved };
}

const http = (status: number, message = 'nope') => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());

const move: MoveQuery = { zone: 'Palermo', home: '1br', currency: 'ARS', country: 'Argentina', today: '2026-10-02' };
const trip: TripQuery = { stops: [{ place: 'Madrid', days: 7 }], people: 1, style: 'mid', origin: '', country: 'Argentina', currency: 'ARS', month: '2027-03', today: '2026-10-02' };
const ctx = { key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', model: 'claude-opus-5-5' } as const;

describe('estimateMove', () => {
  it('asks for rents in that place and returns the answer with what it is based on', async () => {
    const answer = '{"rent": 650000, "rentLow": 520000, "rentHigh": 780000, "monthlyExtras": 120000, "depositMonths": 1, "commissionMonths": 1, "advanceMonths": 1, "confidence": "medium", "notes": "ok"}';
    const { client, requests } = fakeClient([[results([{ url: 'https://a.example/', title: 'A' }]), text(answer)]]);
    const result = await estimateMove(move, { ...ctx, client });
    expect(result.rent).toBe(650000_00);
    expect(result.monthlyExtras).toBe(120000_00);
    expect(result.live).toBe(true);
    expect(result.sources).toEqual([{ title: 'A', url: 'https://a.example/' }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.model).toBe('claude-opus-5-5');
    expect(JSON.stringify(requests[0]!.messages)).toContain('Palermo');
    expect(requests[0]!.tools).toBeDefined();
  });

  it('uses the model that was chosen', async () => {
    const { client, requests } = fakeClient([[text('{"rent": 1000}')]]);
    await estimateMove(move, { ...ctx, model: 'claude-sonnet-5-5', client });
    expect(requests[0]!.model).toBe('claude-sonnet-5-5');
  });

  it('says so when the answer comes from what the model knew and not from a search', async () => {
    const { client } = fakeClient([http(400), [text('{"rent": 1000}')]]);
    const result = await estimateMove(move, { ...ctx, client });
    expect(result.live).toBe(false);
    expect(result.sources).toEqual([]);
  });

  it('fails with a readable error when the answer has no usable numbers', async () => {
    const { client } = fakeClient([[text('No encontré nada.')]]);
    const error = await estimateMove(move, { ...ctx, client }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('bad-answer');
  });

  it('turns a rejected key into a message about the key', async () => {
    const { client } = fakeClient([http(401, 'invalid x-api-key')]);
    const error = await estimateMove(move, { ...ctx, client }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('bad-key');
  });

  it('reports a cancel as a cancel', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = fakeClient([new Anthropic.APIUserAbortError()]);
    const error = await estimateMove(move, { ...ctx, client, signal: controller.signal }).catch((e: unknown) => e);
    expect((error as AiError).code).toBe('aborted');
  });
});

describe('estimateTripPrices', () => {
  it('returns the flight, the daily prices and the transfer price', async () => {
    const answer = '{"flightPerPerson": 1150, "hopPerPerson": 0, "stops": [{"place": "Madrid", "dailyPerPerson": 130}], "confidence": "high", "notes": "ok"}';
    const { client, requests } = fakeClient([[text(answer)]]);
    const result = await estimateTripPrices(trip, { ...ctx, client });
    expect(result).toMatchObject({ flightUsd: 1150, hopUsd: 0, daily: [130], confidence: 'high', live: false });
    expect(JSON.stringify(requests[0]!.messages)).toContain('Madrid, 7 days');
  });

  it('matches the stops it was asked about, not the ones the model decided to talk about', async () => {
    const two: TripQuery = { ...trip, stops: [{ place: 'Madrid', days: 3 }, { place: 'Lisboa', days: 3 }] };
    const answer = '{"flightPerPerson": 1000, "stops": [{"place": "Lisboa", "dailyPerPerson": 110}, {"place": "Madrid", "dailyPerPerson": 130}, {"place": "Paris", "dailyPerPerson": 200}]}';
    const { client } = fakeClient([[text(answer)]]);
    expect((await estimateTripPrices(two, { ...ctx, client })).daily).toEqual([130, 110]);
  });

  it('fails with a readable error when there is no flight price', async () => {
    const { client } = fakeClient([[text('{"stops": []}')]]);
    await expect(estimateTripPrices(trip, { ...ctx, client })).rejects.toMatchObject({ code: 'bad-answer' });
  });

  it('turns a service that has run out of credit into a message about credit', async () => {
    const { client } = fakeClient([http(402, 'billing')]);
    await expect(estimateTripPrices(trip, { ...ctx, client })).rejects.toMatchObject({ code: 'no-credit' });
  });
});

describe('checkKey', () => {
  it('looks the model up, which costs nothing, instead of asking it something', async () => {
    const { client, requests, retrieved } = fakeClient([]);
    await checkKey(ctx.key, 'claude-opus-5-5', undefined, client);
    expect(retrieved).toEqual([{ model: 'claude-opus-5-5', params: null }]);
    expect(requests).toHaveLength(0);
  });

  it('fails with a readable error for a key that is not accepted', async () => {
    const { client } = fakeClient([http(401)]);
    await expect(checkKey(ctx.key, 'claude-opus-5-5', undefined, client)).rejects.toMatchObject({ code: 'bad-key' });
  });

  it('fails with a readable error for a model the account cannot use', async () => {
    const { client } = fakeClient([http(404)]);
    await expect(checkKey(ctx.key, 'claude-sonnet-5-5', undefined, client)).rejects.toMatchObject({ code: 'no-model' });
  });

  it('fails with a readable error when there is no connection', async () => {
    const { client } = fakeClient([new Anthropic.APIConnectionError({ message: 'fetch failed' })]);
    await expect(checkKey(ctx.key, 'claude-opus-5-5', undefined, client)).rejects.toMatchObject({ code: 'offline' });
  });
});
