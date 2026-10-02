import { AiError } from './types';

const noCredit = () => new AiError('no-credit', 'Tu cuenta de Anthropic no tiene saldo. Carga crédito en console.anthropic.com (Plans & Billing) y vuelve a intentar.');

function fromStatus(status: number | undefined, message: string): AiError {
  switch (status) {
    case 401:
      return new AiError('bad-key', 'Anthropic no aceptó la clave. Revisa que esté completa y vigente.');
    case 402:
      return noCredit();
    case 403:
      return new AiError('bad-key', 'Tu clave no tiene permiso para hacer esta consulta.');
    case 404:
      return new AiError('no-model', 'Ese modelo no está disponible en tu cuenta. Prueba con el otro modelo.');
    case 429:
      return new AiError('rate-limit', 'Hiciste muchas consultas seguidas. Espera un momento y vuelve a intentar.');
  }
  // Accounts without credit have answered with a plain 400 and this sentence.
  if (status === 400 && /credit balance/i.test(message)) return noCredit();
  if (status !== undefined && status >= 500) return new AiError('busy', 'Anthropic tiene mucha demanda ahora. Inténtalo en unos minutos.');
  return new AiError('failed', `La consulta no salió bien${status ? ` (error ${status})` : ''}. Inténtalo de nuevo.`);
}

/** Turns anything thrown while talking to the API into an error with a message to show. */
export async function describeError(err: unknown, signal?: AbortSignal): Promise<AiError> {
  if (err instanceof AiError) return err;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) return new AiError('aborted', 'Consulta cancelada.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout', 'La consulta tardó demasiado. Inténtalo de nuevo.');
  if (err instanceof Anthropic.APIConnectionError) return new AiError('offline', 'No pude conectarme a internet. Revisa tu conexión.');
  if (err instanceof Anthropic.APIError) return fromStatus(err.status, err.message);
  return new AiError('failed', 'Algo salió mal. Inténtalo de nuevo.');
}
