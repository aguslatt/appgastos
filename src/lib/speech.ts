/*
 * Thin wrapper over the browser's speech recognition (Chrome, Safari). It is an
 * enhancement: where it's missing the mic button simply isn't shown, and the
 * keyboard's own dictation key still works in the text field.
 */

interface RecognitionResultItem {
  transcript: string;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<RecognitionResultItem> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechSupported = (): boolean => ctor() !== undefined;

export type SpeechProblem = 'denied' | 'silence' | 'unsupported' | 'other';

export interface Listening {
  stop(): void;
}

export function listen(opts: {
  lang: string;
  onText: (text: string, isFinal: boolean) => void;
  onEnd: () => void;
  onProblem: (problem: SpeechProblem) => void;
}): Listening | null {
  const Ctor = ctor();
  if (!Ctor) {
    opts.onProblem('unsupported');
    return null;
  }
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result) continue;
      text += result[0]?.transcript ?? '';
      final = result.isFinal;
    }
    opts.onText(text.trim(), final);
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') opts.onProblem('denied');
    else if (e.error === 'no-speech' || e.error === 'aborted') opts.onProblem('silence');
    else opts.onProblem('other');
  };
  rec.onend = () => opts.onEnd();
  try {
    rec.start();
  } catch {
    opts.onProblem('other');
    return null;
  }
  return { stop: () => rec.stop() };
}
