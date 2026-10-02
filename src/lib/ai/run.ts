import type Anthropic from '@anthropic-ai/sdk';
import type { AiModelId } from './config';
import { AiError, type AiProgress, type AiSource } from './types';

type ContentBlock = Anthropic.ContentBlock;

/** The slice of the SDK that this module uses, so tests can stand in for the network. */
export interface MessageStreamLike {
  on(event: 'contentBlock', listener: (block: ContentBlock) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
}

export interface ClientLike {
  messages: {
    stream(params: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): MessageStreamLike;
  };
  models: {
    retrieve(model: string, params?: null, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

const MAX_TOKENS = 16_000;
const MAX_SEARCHES = 5;
/** A turn that uses search tools can pause part-way; resuming it a few times is plenty for a handful of searches. */
const MAX_RESUMES = 4;
const MAX_SOURCES = 6;

export interface AiRunInput {
  client: ClientLike;
  model: AiModelId;
  system: string;
  prompt: string;
  /** Let the model search the web. If the account can't use search, it answers from what it knows instead. */
  search: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: AiProgress) => void;
}

export interface AiRunOutput {
  /** Everything the model wrote, joined: the answer is somewhere in it. */
  text: string;
  /** What the answer leans on, most relevant first. */
  sources: AiSource[];
  /** Searches that came back with results. */
  searches: number;
  /** True when the answer is based on search results, not only on what the model already knew. */
  live: boolean;
}

const statusOf = (err: unknown): number | undefined =>
  typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : undefined;

function queryOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('query' in input) || typeof input.query !== 'string') return undefined;
  return input.query.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
}

/** A link that is safe to put in front of someone: web addresses only, never `javascript:` and friends. */
function toSource(url: string, title: string | null | undefined): AiSource | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const clean = title?.replace(/\s+/g, ' ').trim().slice(0, 90);
  return { title: clean || parsed.hostname.replace(/^www\./, ''), url: parsed.href };
}

function summarize(blocks: readonly ContentBlock[]): AiRunOutput {
  const cited: AiSource[] = [];
  const found: AiSource[] = [];
  const texts: string[] = [];
  let searches = 0;

  for (const block of blocks) {
    if (block.type === 'text') {
      texts.push(block.text);
      for (const citation of block.citations ?? []) {
        if (citation.type !== 'web_search_result_location') continue;
        const source = toSource(citation.url, citation.title);
        if (source) cited.push(source);
      }
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      if (block.content.length > 0) searches++;
      for (const result of block.content) {
        const source = toSource(result.url, result.title);
        if (source) found.push(source);
      }
    }
  }

  // What the answer cited comes first; the rest of what the searches returned fills the list.
  const seen = new Set<string>();
  const sources = [...cited, ...found]
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .slice(0, MAX_SOURCES);
  return { text: texts.join('\n'), sources, searches, live: searches > 0 };
}

async function generate(input: AiRunInput, search: boolean): Promise<AiRunOutput> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.prompt }];
  const blocks: ContentBlock[] = [];
  let started = 0;

  for (let turn = 0; turn <= MAX_RESUMES; turn++) {
    const stream = input.client.messages.stream(
      {
        model: input.model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'medium' },
        system: input.system,
        messages,
        ...(search && { tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: MAX_SEARCHES }] }),
      },
      { signal: input.signal },
    );

    stream.on('contentBlock', (block) => {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        started++;
        input.onProgress?.({ phase: 'search', searches: started, query: queryOf(block.input) });
      } else if (block.type === 'web_search_tool_result') {
        input.onProgress?.({ phase: 'read', searches: started });
      } else if (block.type === 'text') {
        input.onProgress?.({ phase: 'write', searches: started });
      }
    });

    const message = await stream.finalMessage();
    blocks.push(...message.content);
    if (message.stop_reason === 'refusal') throw new AiError('refused', 'La IA no quiso responder esa consulta. Prueba escribiéndola de otra forma.');
    if (message.stop_reason !== 'pause_turn') break;
    // The server stopped to let us continue: hand its turn back as it was and it picks up where it left off.
    messages.push({ role: 'assistant', content: message.content });
  }

  return summarize(blocks);
}

/** One question to the model, with web search when asked for. */
export async function runAi(input: AiRunInput): Promise<AiRunOutput> {
  if (!input.search) return generate(input, false);
  try {
    return await generate(input, true);
  } catch (err) {
    // An account that hasn't turned web search on gets a 400. Answering from what the model knows
    // beats failing, and the result says it was not a live search.
    if (statusOf(err) !== 400 || input.signal?.aborted) throw err;
    return generate(input, false);
  }
}
