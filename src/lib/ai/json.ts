export type JsonObject = Record<string, unknown>;

/** Characters looked at in total. Real answers need a few thousand; this only stops text built to be slow. */
const MAX_STEPS = 3_000_000;

/** Index of the brace that closes the object opened at `start`, or -1. Braces inside strings don't count. */
function closingBrace(text: string, start: number, budget: { steps: number }): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    if (++budget.steps > MAX_STEPS) return -1;
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Every complete JSON object in a piece of text, in order. Models like to wrap an answer in a
 * sentence or a code fence, so the object is looked for instead of assuming the text is only it.
 * An object whose first key is quoted is where one can start (`{"a": 1}`); a lone `{` in prose isn't.
 */
export function jsonObjects(text: string): JsonObject[] {
  const found: JsonObject[] = [];
  const budget = { steps: 0 };
  const opening = /\{\s*"/g;
  let from = 0;
  while (budget.steps <= MAX_STEPS) {
    opening.lastIndex = from;
    const match = opening.exec(text);
    if (!match) break;
    const end = closingBrace(text, match.index, budget);
    if (end !== -1) {
      try {
        const value: unknown = JSON.parse(text.slice(match.index, end + 1));
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          found.push(value as JsonObject);
          from = end + 1;
          continue;
        }
      } catch {
        // not valid JSON as a whole; an object inside it still might be
      }
    }
    from = match.index + 1;
  }
  return found;
}
