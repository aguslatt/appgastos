import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { checkKey, estimateMove, estimateTripPrices, type MoveQuery, type TripQuery } from './index';
import { runAi, type ClientLike } from './run';
import type { AiProgress } from './types';

/*
 * These run the real SDK, not a stand-in: only the network underneath is replaced, with answers in
 * the shape the Messages API streams. They check that the request we build is accepted by the SDK,
 * that its stream parser hands back what the rest of the code expects, and that real SDK errors
 * come out as the messages the person sees.
 */

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const encoder = new TextEncoder();
type Ev = [string, Record<string, unknown>];

const frame = ([type, data]: Ev) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

function answer({ searches = [], text, citations = [], stop = 'end_turn' }: { searches?: Array<{ query: string; results: Array<{ url: string; title: string }> }>; text: string; citations?: Array<{ url: string; title: string }>; stop?: string }): Ev[] {
  const ev: Ev[] = [['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }]];
  let i = 0;
  for (const s of searches) {
    const json = JSON.stringify({ query: s.query });
    ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'server_tool_use', id: `srvtoolu_${i}`, name: 'web_search', input: {}, caller: { type: 'direct' } } }]);
    ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(0, 9) } }]);
    ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(9) } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    i++;
    ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'web_search_tool_result', tool_use_id: `srvtoolu_${i - 1}`, caller: { type: 'direct' }, content: s.results.map((r) => ({ type: 'web_search_result', encrypted_content: 'enc', page_age: null, ...r })) } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    i++;
  }
  ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '', citations: null } }]);
  ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: text.slice(0, 20) } }]);
  ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: text.slice(20) } }]);
  for (const c of citations) ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', cited_text: '...', encrypted_index: 'i', ...c } } }]);
  ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
  ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } }]);
  ev.push(['message_stop', { type: 'message_stop' }]);
  return ev;
}

const sseResponse = (events: Ev[]) => new Response(new ReadableStream({ start(c) { events.forEach((e) => c.enqueue(frame(e))); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, type: string, message: string) => jsonResponse(status, { type: 'error', error: { type, message } });

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, any> | null;
  signal: AbortSignal | null | undefined;
}

/** The real SDK on top of a fake network: `reply` answers each request, in order, and every request is kept. */
function sdkWith(reply: (sent: Sent, n: number) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const client = new Anthropic({
    apiKey: KEY,
    maxRetries: 0,
    fetch: async (input, init) => {
      const request: Sent = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, signal: init?.signal };
      sent.push(request);
      return reply(request, sent.length);
    },
  });
  const asClient: ClientLike = client; // also proves the SDK fits what the code asks of it
  return { client: asClient, sent };
}

const base = { model: 'claude-opus-5-5', system: 'SYS', prompt: 'PROMPT' } as const;
const MOVE = '{"rent": 650000, "rentLow": 520000, "rentHigh": 780000, "monthlyExtras": 120000, "depositMonths": 1, "commissionMonths": 1, "advanceMonths": 1, "confidence": "high", "notes": "ok"}';
const move: MoveQuery = { zone: 'Palermo', home: '1br', currency: 'ARS', country: 'Argentina', today: '2026-10-02' };
const trip: TripQuery = { stops: [{ place: 'Madrid', days: 5 }], people: 1, style: 'mid', origin: '', country: null, currency: 'ARS', month: '2027-03', today: '2026-10-02' };
const ctx = { key: KEY, model: 'claude-opus-5-5' } as const;

describe('the request the SDK sends', () => {
  it('goes to the messages endpoint as a streamed request with the key, the tool and our parameters', async () => {
    const { client, sent } = sdkWith(() => sseResponse(answer({ text: '{}' })));
    await runAi({ ...base, client, search: true });
    const [request] = sent;
    expect(request?.method).toBe('POST');
    expect(new URL(request!.url).pathname).toBe('/v1/messages');
    expect(request?.headers.get('x-api-key')).toBe(KEY);
    expect(request?.headers.get('anthropic-version')).toBeTruthy();
    expect(request?.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16_000,
      stream: true,
      system: 'SYS',
      messages: [{ role: 'user', content: 'PROMPT' }],
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      output_config: { effort: 'medium' },
    });
    for (const knob of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) expect(request?.body).not.toHaveProperty(knob);
  });

  it('has no tool when search is off', async () => {
    const { client, sent } = sdkWith(() => sseResponse(answer({ text: '{}' })));
    await runAi({ ...base, client, search: false });
    expect(sent[0]?.body).not.toHaveProperty('tools');
  });

  it('looks a model up with a plain GET and the key', async () => {
    const { client, sent } = sdkWith(() => jsonResponse(200, { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }));
    await checkKey(KEY, 'claude-opus-5-5', undefined, client);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('GET');
    expect(new URL(sent[0]!.url).pathname).toBe('/v1/models/claude-opus-5-5');
    expect(sent[0]?.headers.get('x-api-key')).toBe(KEY);
  });
});

describe('what the SDK hands back from a streamed answer', () => {
  it('gives the text, the sources and whether it was live', async () => {
    const { client } = sdkWith(() =>
      sseResponse(
        answer({
          searches: [{ query: 'alquiler palermo', results: [{ url: 'https://a.example/1', title: 'A' }, { url: 'https://b.example/2', title: 'B' }] }, { query: 'expensas', results: [] }],
          text: `Aquí va: ${MOVE}`,
          citations: [{ url: 'https://b.example/2', title: 'B cited' }],
        }),
      ),
    );
    const out = await runAi({ ...base, client, search: true });
    expect(out.text).toBe(`Aquí va: ${MOVE}`);
    expect(out.live).toBe(true);
    expect(out.searches).toBe(1);
    expect(out.sources.map((s) => s.url)).toEqual(['https://b.example/2', 'https://a.example/1']);
    expect(out.sources[0]?.title).toBe('B cited');
  });

  it('reports progress while the answer is still arriving, not only at the end', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const events = answer({ searches: [{ query: 'primera búsqueda', results: [{ url: 'https://a.example/1', title: 'A' }] }], text: MOVE });
    const firstSearchEnds = events.findIndex(([type, data]) => type === 'content_block_stop' && data.index === 0);
    const { client } = sdkWith(
      () =>
        new Response(
          new ReadableStream({
            async start(c) {
              for (const [i, e] of events.entries()) {
                c.enqueue(frame(e));
                // After the first search is complete, hold the rest back until the app has reacted to it.
                if (i === firstSearchEnds) await gate;
              }
              c.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const seen: AiProgress[] = [];
    const out = await runAi({
      ...base,
      client,
      search: true,
      onProgress: (p) => {
        seen.push(p);
        if (p.phase === 'search') release();
      },
    });
    expect(seen[0]).toEqual({ phase: 'search', searches: 1, query: 'primera búsqueda' });
    expect(seen.map((p) => p.phase)).toEqual(['search', 'read', 'write']);
    expect(out.text).toBe(MOVE);
  });

  it('fills in the whole question of a search that arrived in pieces', async () => {
    const { client } = sdkWith(() => sseResponse(answer({ searches: [{ query: 'una consulta que llega en dos partes', results: [] }], text: '{}' })));
    const seen: AiProgress[] = [];
    await runAi({ ...base, client, search: true, onProgress: (p) => seen.push(p) });
    expect(seen[0]?.query).toBe('una consulta que llega en dos partes');
  });
});

describe('a turn that pauses, with the real SDK', () => {
  it('is sent back as the SDK received it, and the second answer is the one that counts', async () => {
    const { client, sent } = sdkWith((_r, n) =>
      sseResponse(n === 1 ? answer({ searches: [{ query: 'uno', results: [{ url: 'https://a.example/1', title: 'A' }] }], text: 'Sigo…', stop: 'pause_turn' }) : answer({ text: MOVE })),
    );
    const out = await runAi({ ...base, client, search: true });
    expect(sent).toHaveLength(2);
    const handedBack = sent[1]?.body?.messages;
    expect(handedBack).toHaveLength(2);
    expect(handedBack[1].role).toBe('assistant');
    expect(handedBack[1].content.map((b: { type: string }) => b.type)).toEqual(['server_tool_use', 'web_search_tool_result', 'text']);
    expect(handedBack[1].content[0]).toMatchObject({ type: 'server_tool_use', id: 'srvtoolu_0', name: 'web_search', input: { query: 'uno' } });
    expect(out.text).toContain(MOVE);
    expect(out.sources.map((s) => s.url)).toEqual(['https://a.example/1']);
  });
});

describe('real failures, as the person sees them', () => {
  it('a key that is not accepted', async () => {
    const { client } = sdkWith(() => apiError(401, 'authentication_error', 'invalid x-api-key'));
    await expect(estimateMove(move, { ...ctx, client })).rejects.toMatchObject({ name: 'AiError', code: 'bad-key' });
    await expect(checkKey(KEY, 'claude-opus-5-5', undefined, sdkWith(() => apiError(401, 'authentication_error', 'x')).client)).rejects.toMatchObject({ code: 'bad-key' });
  });

  it('an account without credit', async () => {
    const { client } = sdkWith(() => apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'));
    // the 400 first tries once more without search, which fails the same way
    await expect(estimateTripPrices(trip, { ...ctx, client })).rejects.toMatchObject({ code: 'no-credit' });
  });

  it('a model the account cannot use', async () => {
    const { client } = sdkWith(() => apiError(404, 'not_found_error', 'model: claude-opus-5-5'));
    await expect(checkKey(KEY, 'claude-opus-5-5', undefined, client)).rejects.toMatchObject({ code: 'no-model' });
  });

  it('too many requests and an overloaded service', async () => {
    await expect(estimateMove(move, { ...ctx, client: sdkWith(() => apiError(429, 'rate_limit_error', 'slow down')).client })).rejects.toMatchObject({ code: 'rate-limit' });
    await expect(estimateMove(move, { ...ctx, client: sdkWith(() => apiError(529, 'overloaded_error', 'busy')).client })).rejects.toMatchObject({ code: 'busy' });
  });

  it('no connection', async () => {
    const { client } = sdkWith(() => {
      throw new TypeError('fetch failed');
    });
    await expect(estimateMove(move, { ...ctx, client })).rejects.toMatchObject({ code: 'offline' });
  });

  it('a cancel while waiting', async () => {
    const controller = new AbortController();
    // Like the real fetch: a request that is waiting fails as soon as it is aborted.
    const { client, sent } = sdkWith(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        }),
    );
    const pending = estimateMove(move, { ...ctx, client, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(sent).toHaveLength(1);
  });

  it('an account without web search is asked again without it, and the answer says it was not live', async () => {
    const { client, sent } = sdkWith((_r, n) => (n === 1 ? apiError(400, 'invalid_request_error', 'web_search is not enabled for this organization') : sseResponse(answer({ text: MOVE }))));
    const result = await estimateMove(move, { ...ctx, client });
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body).toHaveProperty('tools');
    expect(sent[1]?.body).not.toHaveProperty('tools');
    expect(result).toMatchObject({ rent: 650000_00, live: false, sources: [], confidence: 'high' });
  });

  it('a refusal', async () => {
    const { client } = sdkWith(() => sseResponse(answer({ text: '', stop: 'refusal' })));
    await expect(estimateMove(move, { ...ctx, client })).rejects.toMatchObject({ code: 'refused' });
  });
});

describe('end to end with the real SDK', () => {
  it('turns a streamed answer with searches into a rent estimate', async () => {
    const { client } = sdkWith(() =>
      sseResponse(answer({ searches: [{ query: 'q', results: [{ url: 'https://a.example/1', title: 'A' }] }], text: `\`\`\`json\n${MOVE}\n\`\`\`` })),
    );
    const result = await estimateMove(move, { ...ctx, client });
    expect(result).toMatchObject({ rent: 650000_00, rentLow: 520000_00, rentHigh: 780000_00, monthlyExtras: 120000_00, live: true });
    expect(result.sources).toEqual([{ title: 'A', url: 'https://a.example/1' }]);
  });

  it('turns a streamed answer into trip prices', async () => {
    const { client } = sdkWith(() => sseResponse(answer({ text: '{"flightPerPerson": 1200, "hopPerPerson": 0, "stops": [{"place": "Madrid", "dailyPerPerson": 140}], "confidence": "medium", "notes": "ok"}' })));
    expect(await estimateTripPrices(trip, { ...ctx, client })).toMatchObject({ flightUsd: 1200, hopUsd: 0, daily: [140], confidence: 'medium' });
  });
});
