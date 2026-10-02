export type AiErrorCode =
  | 'no-key'
  | 'bad-key'
  | 'no-credit'
  | 'no-model'
  | 'rate-limit'
  | 'busy'
  | 'offline'
  | 'timeout'
  | 'refused'
  | 'bad-answer'
  | 'aborted'
  | 'failed';

/** A failure whose message is already written for the person using the app. */
export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

export interface AiSource {
  title: string;
  url: string;
}

/** What the model is doing right now, for the progress line while the person waits. */
export interface AiProgress {
  phase: 'search' | 'read' | 'write';
  /** Searches started so far. */
  searches: number;
  /** What it is looking up (only in the `search` phase). */
  query?: string;
}

export type Confidence = 'low' | 'medium' | 'high';
