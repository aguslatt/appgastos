import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { runAi, type ClientLike } from './run';
import { AiError, type AiProgress } from './types';

type Block = Anthropic.ContentBlock;

// ---- stand-ins for the network ---------------------------------------------------------------------

const text = (t: string, citations: Array<{ url: string; title: string | null }> = []): Block =>
  ({ type: 'text', text: t, citations: citations.length ? citations.map((c) => ({ type: 'web_search_result_location', cited_text: '...', encrypted_index: 'x', ...c })) : null }) as unknown as Block;

const searching = (id: string, query: string): Block => ({ type: 'server_tool_use', id, name: 'web_search', input: { query }, caller: { type: 'direct' } }) as unknown as Block;

const results = (id: string, list: Array<{ url: string; title: string }>): Block =>
  ({ type: 'web_search_tool_result', tool_use_id: id, caller: { type: 'direct' }, content: list.map((r) => ({ type: 'web_search_result', encrypted_content: 'enc', page_age: null, ...r })) }) as unknown as Block;

const searchFailed = (id: string, code = 'unavailable'): Block =>
  ({ type: 'web_search_tool_result', tool_use_id: id, caller: { type: 'direct' }, content: { type: 'web_search_tool_result_error', error_code: code } }) as unknown as Block;

type Turn = { content: Block[]; stop_reason?: Anthropic.StopReason } | Error;

function fakeClient(turns: Turn[]) {
  const queue = [...turns];
  const calls: Array<{ params: Anthropic.MessageStreamParams; signal: AbortSignal | undefined }> = [];
  const client: ClientLike = {
    messages: {
      stream(params, options) {
        // The loop adds to its messages array as it goes, so keep what was true at the time of the call.
        calls.push({ params: structuredClone(params), signal: options?.signal });
        const turn = queue.shift();
        const listeners: Array<(b: Block) => void> = [];
        return {
          on(_event, listener) {
            listeners.push(listener);
            return this;
          },
          async finalMessage() {
            if (!turn) throw new Error('the fake ran out of answers');
            if (turn instanceof Error) throw turn;
            for (const block of turn.content) listeners.forEach((l) => l(block));
            return { id: 'msg_1', type: 'message', role: 'assistant', content: turn.content, stop_reason: turn.stop_reason ?? 'end_turn' } as unknown as Anthropic.Message;
          },
        };
      },
    },
    models: { retrieve: async () => ({}) },
  };
  return { client, calls };
}

const status = (code: number): Error => Object.assign(new Error(`http ${code}`), { status: code });

const base = { model: 'claude-opus-5-5', system: 'SYS', prompt: 'PROMPT' } as const;

// ---- the request ------------------------------------------------------------------------------------

describe('the request', () => {
  it('asks the chosen model, with the instructions and the prompt, and no tools when search is off', async () => {
    const { client, calls } = fakeClient([{ content: [text('{"a":1}')] }]);
    const out = await runAi({ ...base, client, search: false });
    expect(calls).toHaveLength(1);
    const { params } = calls[0]!;
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.system).toBe('SYS');
    expect(params.messages).toEqual([{ role: 'user', content: 'PROMPT' }]);
    expect(params).not.toHaveProperty('tools');
    expect(out).toEqual({ text: '{"a":1}', sources: [], searches: 0, live: false });
  });

  it('adds the web search tool, limited to a few searches, when search is on', async () => {
    const { client, calls } = fakeClient([{ content: [text('x')] }]);
    await runAi({ ...base, client, search: true });
    expect(calls[0]!.params.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]);
  });

  it('keeps cost and shape predictable: medium effort, a generous token ceiling, no sampling knobs', async () => {
    const { client, calls } = fakeClient([{ content: [text('x')] }]);
    await runAi({ ...base, client, search: true });
    const params = calls[0]!.params as unknown as Record<string, unknown>;
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.max_tokens).toBe(16_000);
    for (const knob of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice', 'betas', 'fallbacks']) expect(params).not.toHaveProperty(knob);
  });

  it('hands the cancel signal to the request', async () => {
    const { client, calls } = fakeClient([{ content: [text('x')] }]);
    const controller = new AbortController();
    await runAi({ ...base, client, search: true, signal: controller.signal });
    expect(calls[0]!.signal).toBe(controller.signal);
  });
});

// ---- what comes back ---------------------------------------------------------------------------------

describe('reading the answer', () => {
  it('joins everything the model wrote, so the answer is found wherever it is', async () => {
    const { client } = fakeClient([{ content: [text('Voy a buscar.'), searching('s1', 'q'), results('s1', []), text('{"a":1}')] }]);
    expect((await runAi({ ...base, client, search: true })).text).toBe('Voy a buscar.\n{"a":1}');
  });

  it('is live when a search came back with results, and counts those searches', async () => {
    const { client } = fakeClient([
      {
        content: [
          searching('s1', 'alquiler palermo'),
          results('s1', [{ url: 'https://a.example/1', title: 'A' }]),
          searching('s2', 'expensas palermo'),
          results('s2', [{ url: 'https://b.example/1', title: 'B' }]),
          text('{}'),
        ],
      },
    ]);
    const out = await runAi({ ...base, client, search: true });
    expect(out.live).toBe(true);
    expect(out.searches).toBe(2);
  });

  it('is not live when every search failed or found nothing', async () => {
    const { client } = fakeClient([{ content: [searching('s1', 'q'), searchFailed('s1'), searching('s2', 'q2'), results('s2', []), text('{}')] }]);
    const out = await runAi({ ...base, client, search: true });
    expect(out.live).toBe(false);
    expect(out.searches).toBe(0);
  });

  it('lists what the answer cited first, then the rest of what was found, once each', async () => {
    const { client } = fakeClient([
      {
        content: [
          results('s1', [
            { url: 'https://found.example/a', title: 'Found A' },
            { url: 'https://cited.example/x', title: 'Cited X (from results)' },
            { url: 'https://found.example/b', title: 'Found B' },
          ]),
          text('{}', [{ url: 'https://cited.example/x', title: 'Cited X' }]),
        ],
      },
    ]);
    const { sources } = await runAi({ ...base, client, search: true });
    expect(sources.map((s) => s.url)).toEqual(['https://cited.example/x', 'https://found.example/a', 'https://found.example/b']);
    expect(sources[0]!.title).toBe('Cited X');
  });

  it('shows at most six sources', async () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ url: `https://s${i}.example/`, title: `S${i}` }));
    const { client } = fakeClient([{ content: [results('s1', list), text('{}')] }]);
    expect((await runAi({ ...base, client, search: true })).sources).toHaveLength(6);
  });

  it('only ever offers web addresses', async () => {
    const { client } = fakeClient([
      {
        content: [
          results('s1', [
            { url: 'javascript:alert(1)', title: 'bad' },
            { url: 'data:text/html,<script>alert(1)</script>', title: 'bad' },
            { url: 'file:///etc/passwd', title: 'bad' },
            { url: 'not a url', title: 'bad' },
            { url: 'http://plain.example/', title: 'plain' },
            { url: 'https://ok.example/', title: 'ok' },
          ]),
          text('{}', [{ url: 'javascript:alert(2)', title: 'bad cite' }]),
        ],
      },
    ]);
    const { sources } = await runAi({ ...base, client, search: true });
    expect(sources.map((s) => s.url)).toEqual(['http://plain.example/', 'https://ok.example/']);
  });

  it('titles a source by its site when it has no title, and tidies long titles', async () => {
    const { client } = fakeClient([{ content: [results('s1', [{ url: 'https://www.zonaprop.com.ar/x', title: '   ' }, { url: 'https://b.example/', title: `  Muy   largo ${'y'.repeat(200)}` }]), text('{}')] }]);
    const { sources } = await runAi({ ...base, client, search: true });
    expect(sources[0]!.title).toBe('zonaprop.com.ar');
    expect(sources[1]!.title.length).toBeLessThanOrEqual(90);
    expect(sources[1]!.title).toMatch(/^Muy largo y+/);
  });

  it('ignores citations that are not from a web search', async () => {
    const odd = { type: 'text', text: '{}', citations: [{ type: 'char_location', cited_text: 'x', document_index: 0, document_title: null, start_char_index: 0, end_char_index: 1 }] } as unknown as Block;
    const { client } = fakeClient([{ content: [odd] }]);
    expect((await runAi({ ...base, client, search: true })).sources).toEqual([]);
  });
});

// ---- progress ---------------------------------------------------------------------------------------------

describe('progress', () => {
  it('says what is being searched, then that results are being read, then that the answer is being written', async () => {
    const { client } = fakeClient([
      { content: [searching('s1', '  alquiler   2 ambientes palermo '), results('s1', [{ url: 'https://a.example/', title: 'A' }]), searching('s2', 'expensas'), results('s2', []), text('{}')] },
    ]);
    const seen: AiProgress[] = [];
    await runAi({ ...base, client, search: true, onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([
      { phase: 'search', searches: 1, query: 'alquiler 2 ambientes palermo' },
      { phase: 'read', searches: 1 },
      { phase: 'search', searches: 2, query: 'expensas' },
      { phase: 'read', searches: 2 },
      { phase: 'write', searches: 2 },
    ]);
  });

  it('keeps counting searches across a resumed turn', async () => {
    const { client } = fakeClient([
      { content: [searching('s1', 'uno')], stop_reason: 'pause_turn' },
      { content: [searching('s2', 'dos'), text('{}')] },
    ]);
    const seen: AiProgress[] = [];
    await runAi({ ...base, client, search: true, onProgress: (p) => seen.push(p) });
    expect(seen.filter((p) => p.phase === 'search').map((p) => p.searches)).toEqual([1, 2]);
  });

  it('cuts a long query and ignores one that is missing or not text', async () => {
    const odd = { type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 5 }, caller: { type: 'direct' } } as unknown as Block;
    const none = { type: 'server_tool_use', id: 's', name: 'web_search', input: null, caller: { type: 'direct' } } as unknown as Block;
    const { client } = fakeClient([{ content: [searching('s1', 'q'.repeat(300)), odd, none, text('{}')] }]);
    const seen: AiProgress[] = [];
    await runAi({ ...base, client, search: true, onProgress: (p) => seen.push(p) });
    expect(seen[0]!.query).toHaveLength(80);
    expect(seen[1]!.query).toBeUndefined();
    expect(seen[2]!.query).toBeUndefined();
  });

  it('does not mind having nobody listening', async () => {
    const { client } = fakeClient([{ content: [searching('s1', 'q'), results('s1', []), text('{}')] }]);
    await expect(runAi({ ...base, client, search: true })).resolves.toBeDefined();
  });
});

// ---- a turn that pauses ---------------------------------------------------------------------------------

describe('when the server pauses the turn', () => {
  it('hands its turn back as it was, with nothing added, and carries on', async () => {
    const first = [searching('s1', 'q'), results('s1', [{ url: 'https://a.example/', title: 'A' }])];
    const { client, calls } = fakeClient([{ content: first, stop_reason: 'pause_turn' }, { content: [text('{"ok":true}')] }]);
    const out = await runAi({ ...base, client, search: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.params.messages).toEqual([
      { role: 'user', content: 'PROMPT' },
      { role: 'assistant', content: first },
    ]);
    // Sources and the answer come from every turn together.
    expect(out.text).toBe('{"ok":true}');
    expect(out.sources.map((s) => s.url)).toEqual(['https://a.example/']);
    expect(out.live).toBe(true);
  });

  it('keeps the tools on while resuming', async () => {
    const { client, calls } = fakeClient([{ content: [searching('s1', 'q')], stop_reason: 'pause_turn' }, { content: [text('{}')] }]);
    await runAi({ ...base, client, search: true });
    expect(calls[1]!.params.tools).toEqual(calls[0]!.params.tools);
  });

  it('does not go on forever: after a few resumes it settles for what it has', async () => {
    const pausing = Array.from({ length: 20 }, (_, i): Turn => ({ content: [searching(`s${i}`, `q${i}`), text(`parte ${i}`)], stop_reason: 'pause_turn' }));
    const { client, calls } = fakeClient(pausing);
    const out = await runAi({ ...base, client, search: true });
    expect(calls).toHaveLength(5);
    expect(out.text).toContain('parte 4');
  });
});

// ---- when it goes wrong -----------------------------------------------------------------------------------

describe('when the model refuses', () => {
  it('stops with a clear error', async () => {
    const { client } = fakeClient([{ content: [], stop_reason: 'refusal' }]);
    const error = await runAi({ ...base, client, search: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('refused');
  });
});

describe('when the account cannot search the web', () => {
  it('asks again without the tool, and says the answer is not live', async () => {
    const { client, calls } = fakeClient([status(400), { content: [text('{"a":1}')] }]);
    const out = await runAi({ ...base, client, search: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.params.tools).toBeDefined();
    expect(calls[1]!.params).not.toHaveProperty('tools');
    expect(out).toMatchObject({ text: '{"a":1}', live: false, sources: [] });
  });

  it('gives the second failure if the second try fails too', async () => {
    const { client, calls } = fakeClient([status(400), status(401)]);
    await expect(runAi({ ...base, client, search: true })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
  });

  it('does not ask again for any other kind of failure', async () => {
    for (const code of [401, 402, 403, 404, 429, 500, 529]) {
      const { client, calls } = fakeClient([status(code), { content: [text('{}')] }]);
      await expect(runAi({ ...base, client, search: true })).rejects.toMatchObject({ status: code });
      expect(calls).toHaveLength(1);
    }
  });

  it('does not ask again for something that is not an HTTP failure', async () => {
    const { client, calls } = fakeClient([new TypeError('network down'), { content: [text('{}')] }]);
    await expect(runAi({ ...base, client, search: true })).rejects.toThrow('network down');
    expect(calls).toHaveLength(1);
  });

  it('does not ask again after the person cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, calls } = fakeClient([status(400), { content: [text('{}')] }]);
    await expect(runAi({ ...base, client, search: true, signal: controller.signal })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('does not fall back when search was never asked for', async () => {
    const { client, calls } = fakeClient([status(400), { content: [text('{}')] }]);
    await expect(runAi({ ...base, client, search: false })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });
});
