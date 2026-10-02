import { describe, expect, it } from 'vitest';
import { jsonObjects } from './json';

describe('jsonObjects', () => {
  it('reads an answer that is only an object', () => {
    expect(jsonObjects('{"rent": 650000, "confidence": "high"}')).toEqual([{ rent: 650000, confidence: 'high' }]);
  });

  it('finds the object inside a sentence', () => {
    expect(jsonObjects('Aquí está: {"rent": 10} Espero que sirva.')).toEqual([{ rent: 10 }]);
  });

  it('finds the object inside a code fence', () => {
    expect(jsonObjects('```json\n{\n  "rent": 10,\n  "notes": "ok"\n}\n```')).toEqual([{ rent: 10, notes: 'ok' }]);
  });

  it('returns every object, in the order they appear', () => {
    expect(jsonObjects('{"a":1} y luego {"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('keeps a nested object inside its parent instead of listing it again', () => {
    expect(jsonObjects('{"stops":[{"place":"Madrid","dailyPerPerson":120}],"flightPerPerson":1100}')).toEqual([
      { stops: [{ place: 'Madrid', dailyPerPerson: 120 }], flightPerPerson: 1100 },
    ]);
  });

  it('is not fooled by braces inside strings', () => {
    expect(jsonObjects('{"notes": "usa {llaves} y } sueltas", "n": 1}')).toEqual([{ notes: 'usa {llaves} y } sueltas', n: 1 }]);
  });

  it('is not fooled by escaped quotes inside strings', () => {
    expect(jsonObjects('{"notes": "dijo \\"hola {\\" y siguió", "n": 2}')).toEqual([{ notes: 'dijo "hola {" y siguió', n: 2 }]);
  });

  it('skips a stray brace in the prose before the object', () => {
    expect(jsonObjects('Nota {importante: mira esto. {"rent": 5}')).toEqual([{ rent: 5 }]);
  });

  it('finds the objects inside something that is not valid JSON as a whole', () => {
    expect(jsonObjects('{"a": 1, "inner": {"b": 2},}')).toEqual([{ b: 2 }]);
  });

  it('finds objects inside an array', () => {
    expect(jsonObjects('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns nothing for an object that was cut off', () => {
    expect(jsonObjects('{"rent": 650000, "notes": "se cortó aq')).toEqual([]);
  });

  it('returns nothing when there is no object', () => {
    expect(jsonObjects('')).toEqual([]);
    expect(jsonObjects('No encontré datos.')).toEqual([]);
    expect(jsonObjects('[1, 2, 3]')).toEqual([]);
  });

  it('reads unicode, numbers and nulls', () => {
    expect(jsonObjects('{"zona":"Ñuñoa","n":-1.5e3,"x":null,"ok":true}')).toEqual([{ zona: 'Ñuñoa', n: -1500, x: null, ok: true }]);
  });

  it('copes with a long text with many braces without taking forever', () => {
    const noise = '{ '.repeat(2_000);
    const started = Date.now();
    expect(jsonObjects(`${noise}{"rent": 1}`)).toEqual([{ rent: 1 }]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives up quickly on text built to be slow, instead of freezing the app', () => {
    for (const hostile of ['{ '.repeat(60_000), '{"'.repeat(60_000), '{"a":'.repeat(30_000)]) {
      const started = Date.now();
      expect(Array.isArray(jsonObjects(hostile))).toBe(true);
      expect(Date.now() - started).toBeLessThan(1_000);
    }
  });

  it('reads an empty object only as part of something bigger, since an answer always has keys', () => {
    expect(jsonObjects('{}')).toEqual([]);
    expect(jsonObjects('{"a": {}}')).toEqual([{ a: {} }]);
  });

  it('still reads a normal answer that comes after a lot of text', () => {
    const preface = 'Busqué en varias fuentes y comparé los avisos de la zona. '.repeat(300);
    expect(jsonObjects(`${preface}{"rent": 42}`)).toEqual([{ rent: 42 }]);
  });
});
