import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { describeError } from './errors';
import { AiError, type AiErrorCode } from './types';

/** A failure as the SDK raises it for an HTTP answer with this status. */
const http = (status: number, message = 'something went wrong') =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());

describe('describeError', () => {
  it.each<[string, number, AiErrorCode]>([
    ['a key Anthropic does not know', 401, 'bad-key'],
    ['no credit', 402, 'no-credit'],
    ['a key without permission', 403, 'bad-key'],
    ['a model the account cannot use', 404, 'no-model'],
    ['too many requests', 429, 'rate-limit'],
    ['a server error', 500, 'busy'],
    ['an overloaded service', 529, 'busy'],
    ['a bad gateway', 502, 'busy'],
  ])('maps %s (%i) to %s', async (_name, status, code) => {
    const error = await describeError(http(status));
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe(code);
  });

  it('recognizes the old way of saying there is no credit: a 400 with that sentence', async () => {
    const error = await describeError(http(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'));
    expect(error.code).toBe('no-credit');
  });

  it('keeps any other 400 as a general failure that says the status', async () => {
    const error = await describeError(http(400, 'messages: roles must alternate'));
    expect(error.code).toBe('failed');
    expect(error.message).toContain('400');
  });

  it('keeps unexpected statuses as a general failure', async () => {
    expect((await describeError(http(418))).code).toBe('failed');
    expect((await describeError(http(422))).code).toBe('failed');
  });

  it('tells a lost connection from a timeout from a cancel', async () => {
    expect((await describeError(new Anthropic.APIConnectionError({ message: 'fetch failed' }))).code).toBe('offline');
    expect((await describeError(new Anthropic.APIConnectionTimeoutError())).code).toBe('timeout');
    expect((await describeError(new Anthropic.APIUserAbortError())).code).toBe('aborted');
  });

  it('calls anything thrown after the person cancelled a cancel', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await describeError(new TypeError('boom'), controller.signal)).code).toBe('aborted');
    expect((await describeError(http(500), controller.signal)).code).toBe('aborted');
  });

  it('passes our own errors through untouched', async () => {
    const own = new AiError('refused', 'no');
    expect(await describeError(own)).toBe(own);
  });

  it('turns anything else into a general failure without leaking its text', async () => {
    for (const thrown of [new TypeError('x is not a function'), 'a string', 42, null, undefined, { status: 401 }]) {
      const error = await describeError(thrown);
      expect(error.code).toBe('failed');
      expect(error.message).not.toContain('x is not a function');
    }
  });

  it('writes every message for the person, in Spanish, without technical noise', async () => {
    const all = await Promise.all([401, 402, 403, 404, 429, 500, 400].map((s) => describeError(http(s, 'req_011CSHoEeqs5C35K2UUqR7Fy raw body'))));
    all.push(await describeError(new Anthropic.APIConnectionError({})), await describeError(new Anthropic.APIConnectionTimeoutError()));
    for (const error of all) {
      expect(error.message.length).toBeGreaterThan(15);
      expect(error.message).toMatch(/[a-záéíóú]/i);
      expect(error.message).not.toContain('req_');
      expect(error.message).not.toContain('raw body');
    }
  });

  it('never repeats a key in a message', async () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const error = await describeError(http(401, `invalid x-api-key ${key}`));
    expect(error.message).not.toContain(key);
  });
});
