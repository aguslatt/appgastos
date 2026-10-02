import { describe, expect, it } from 'vitest';
import { CURRENCIES, detectLocaleAndCurrency, getMoneyFormatter, isSupportedCurrency, parseAmountText } from './money';

/** Normalizes the no-break / narrow no-break spaces Intl uses between symbol and number. */
const flat = (s: string): string => s.replace(/[  ]/g, ' ');

/** Keeps only digits, separators and the minus sign: the part of a formatted amount that is locale-stable. */
const numeric = (s: string): string => flat(s).replace(/[^\d.,-]/g, '');

/** Groups digits in threes with the given separator ("1234567" -> "1.234.567"). */
const group = (n: number, sep: string): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---- getMoneyFormatter ------------------------------------------------------

describe('getMoneyFormatter', () => {
  describe('es-AR / ARS', () => {
    const f = getMoneyFormatter('es-AR', 'ARS');

    it('exposes its configuration', () => {
      expect(f.locale).toBe('es-AR');
      expect(f.currency).toBe('ARS');
      expect(f.symbol).toBe('$');
      expect(f.decimalSeparator).toBe(',');
    });

    it.each([
      [0, '$ 0'],
      [100, '$ 1'],
      [10_000, '$ 100'],
      [5, '$ 0,05'],
      [99, '$ 0,99'],
      [150, '$ 1,50'],
      [10_001, '$ 100,01'],
      [12_345, '$ 123,45'],
      [100_000, '$ 1.000'],
      [1_250_000, '$ 12.500'],
      [1_250_050, '$ 12.500,50'],
      [12_345_678, '$ 123.456,78'],
      [99_999_900, '$ 999.999'],
      [100_000_000_000, '$ 1.000.000.000'],
    ])('format(%i) = %s (decimals only when the amount has them)', (cents, expected) => {
      expect(flat(f.format(cents))).toBe(expected);
    });

    it('format puts the minus sign before the number', () => {
      expect(flat(f.format(-12_500))).toMatch(/^-\s?\$\s?125$/);
      expect(flat(f.format(-250))).toMatch(/^-\s?\$\s?2,50$/);
    });

    it.each([
      [0, '$ 0'],
      [49, '$ 0'],
      [50, '$ 1'],
      [99, '$ 1'],
      [100, '$ 1'],
      [149, '$ 1'],
      [150, '$ 2'],
      [24_530_049, '$ 245.300'],
      [24_530_050, '$ 245.301'],
      [24_530_099, '$ 245.301'],
    ])('formatRounded(%i) = %s', (cents, expected) => {
      expect(flat(f.formatRounded(cents))).toBe(expected);
    });

    it.each([
      [0, '0'],
      [49, '0'],
      [50, '1'],
      [24_530_000, '245.300'],
      [12_345_678, '123.457'],
      [100_000_000_000, '1.000.000.000'],
    ])('formatNumber(%i) = %s (no symbol, whole units)', (cents, expected) => {
      expect(flat(f.formatNumber(cents))).toBe(expected);
    });

    it('formatCompact shortens thousands and millions', () => {
      expect(f.formatCompact(0)).toBe('0');
      expect(f.formatCompact(99_900)).toBe('999');
      // Intl says "k"/"K" for es-AR where the doc comment says "mil": accept either spelling.
      expect(flat(f.formatCompact(1_250_000))).toMatch(/^12,5 (k|K|mil)$/);
      expect(flat(f.formatCompact(12_500_000))).toMatch(/^125 (k|K|mil)$/);
      expect(flat(f.formatCompact(123_456_789))).toBe('1,2 M');
      expect(flat(f.formatCompact(100_000_000))).toBe('1 M');
      expect(flat(f.formatCompact(100_000))).toMatch(/^1 (k|K|mil)$/);
    });
  });

  describe('other locales', () => {
    it('es-ES / EUR puts the symbol after the number and uses a decimal comma', () => {
      const f = getMoneyFormatter('es-ES', 'EUR');
      expect(f.symbol).toBe('€');
      expect(f.decimalSeparator).toBe(',');
      expect(flat(f.format(1_250_000))).toBe('12.500 €');
      expect(numeric(f.format(1_250_050))).toBe('12.500,50');
    });

    it('es-MX / MXN uses a decimal POINT', () => {
      const f = getMoneyFormatter('es-MX', 'MXN');
      expect(f.symbol).toBe('$');
      expect(f.decimalSeparator).toBe('.');
      expect(numeric(f.format(1_250_050))).toBe('12,500.50');
      expect(numeric(f.format(1_250_000))).toBe('12,500');
    });

    it('en-US / USD', () => {
      const f = getMoneyFormatter('en-US', 'USD');
      expect(f.symbol).toBe('$');
      expect(f.decimalSeparator).toBe('.');
      expect(flat(f.format(1_250_050))).toBe('$12,500.50');
    });

    it('the same currency gets a different symbol where "$" would be ambiguous', () => {
      expect(getMoneyFormatter('es-AR', 'USD').symbol).toBe('US$');
      expect(getMoneyFormatter('es-AR', 'ARS').symbol).toBe('$');
      expect(getMoneyFormatter('es-AR', 'USD').symbol).not.toBe(getMoneyFormatter('es-AR', 'ARS').symbol);
    });

    it.each(CURRENCIES.map((c) => [c.code]))('every listed currency (%s) builds a usable formatter', (code) => {
      const f = getMoneyFormatter('es-AR', code);
      expect(f.symbol.length).toBeGreaterThan(0);
      expect(numeric(f.format(1_250_050))).toBe('12.500,50');
    });
  });

  describe('caching', () => {
    it('returns the same instance for the same locale and currency', () => {
      expect(getMoneyFormatter('es-AR', 'ARS')).toBe(getMoneyFormatter('es-AR', 'ARS'));
    });

    it('returns different instances when either part differs', () => {
      const base = getMoneyFormatter('es-AR', 'ARS');
      expect(getMoneyFormatter('es-AR', 'USD')).not.toBe(base);
      expect(getMoneyFormatter('es-MX', 'ARS')).not.toBe(base);
      expect(getMoneyFormatter('es-AR', 'USD').currency).toBe('USD');
      expect(getMoneyFormatter('es-MX', 'ARS').locale).toBe('es-MX');
    });
  });

  describe('hostile amounts', () => {
    const f = getMoneyFormatter('es-AR', 'ARS');
    const weird = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300, -1e300, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0.5, 1.5, -0, -1];

    it.each([['format'], ['formatRounded'], ['formatNumber'], ['formatCompact']] as const)('%s never throws and always returns text', (method) => {
      for (const cents of weird) {
        expect(typeof f[method](cents)).toBe('string');
      }
    });

    it('keeps every digit of the largest safe amount, give or take the last cent', () => {
      // cents / 100 is a double, which cannot hold 16 significant digits exactly; the units are right.
      expect(numeric(f.format(Number.MAX_SAFE_INTEGER))).toMatch(/^90\.071\.992\.547\.409,9[01]$/);
    });

    it('is exact to the cent for any amount up to 10^14 cents (a billion units)', () => {
      const rng = mulberry32(31);
      const wrong: string[] = [];
      for (let i = 0; i < 2000; i++) {
        const cents = Math.floor(rng() * 1e14);
        const expected = `${group(Math.floor(cents / 100), '.')}${cents % 100 === 0 ? '' : `,${String(cents % 100).padStart(2, '0')}`}`;
        if (numeric(f.format(cents)) !== expected) wrong.push(`${cents} -> ${numeric(f.format(cents))} (wanted ${expected})`);
      }
      expect(wrong).toEqual([]);
    });

    it('rounds a fractional cent instead of printing it', () => {
      expect(numeric(f.format(12.5))).toBe('0,13');
    });
  });

  describe('invalid configuration', () => {
    it('throws a RangeError for a malformed currency or locale (callers must validate first)', () => {
      expect(() => getMoneyFormatter('es-AR', 'ARSS')).toThrow(RangeError);
      expect(() => getMoneyFormatter('es-AR', '')).toThrow(RangeError);
      expect(() => getMoneyFormatter('', 'ARS')).toThrow(RangeError);
    });

    it('does not cache a failed construction', () => {
      expect(() => getMoneyFormatter('es-AR', 'ARSS')).toThrow();
      expect(() => getMoneyFormatter('es-AR', 'ARSS')).toThrow();
      expect(getMoneyFormatter('es-AR', 'ARS').currency).toBe('ARS');
    });
  });
});

// ---- CURRENCIES -------------------------------------------------------------

describe('CURRENCIES', () => {
  it('has unique, well-formed codes with a name each', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('are all accepted by isSupportedCurrency and offer the main ones', () => {
    for (const c of CURRENCIES) expect(isSupportedCurrency(c.code)).toBe(true);
    const codes = CURRENCIES.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['ARS', 'USD', 'EUR', 'MXN', 'CLP', 'COP', 'UYU', 'PEN', 'BRL']));
  });
});

// ---- detectLocaleAndCurrency ------------------------------------------------

describe('detectLocaleAndCurrency', () => {
  // The expected currency per Spanish-speaking region, written down independently of the implementation.
  const REGIONS: Array<[string, string]> = [
    ['AR', 'ARS'], ['MX', 'MXN'], ['CL', 'CLP'], ['CO', 'COP'], ['UY', 'UYU'], ['PE', 'PEN'],
    ['BO', 'BOB'], ['PY', 'PYG'], ['BR', 'BRL'], ['ES', 'EUR'], ['US', 'USD'], ['EC', 'USD'],
    ['PA', 'USD'], ['SV', 'USD'], ['PR', 'USD'], ['CR', 'CRC'], ['GT', 'GTQ'], ['DO', 'DOP'],
  ];

  it.each(REGIONS)('es-%s -> es-%s locale with %s', (region, currency) => {
    expect(detectLocaleAndCurrency(`es-${region}`)).toEqual({ locale: `es-${region}`, currency });
  });

  it.each(REGIONS)('copes with casing and an underscore for es-%s', (region, currency) => {
    const expected = { locale: `es-${region}`, currency };
    expect(detectLocaleAndCurrency(`es_${region}`)).toEqual(expected);
    expect(detectLocaleAndCurrency(`es-${region.toLowerCase()}`)).toEqual(expected);
    expect(detectLocaleAndCurrency(`ES-${region}`)).toEqual(expected);
  });

  it.each(REGIONS)('every detected pair for es-%s can be used to format money', (region) => {
    const { locale, currency } = detectLocaleAndCurrency(`es-${region}`);
    expect(isSupportedCurrency(currency)).toBe(true);
    expect(CURRENCIES.map((c) => c.code)).toContain(currency);
    expect(() => getMoneyFormatter(locale, currency).format(1_250_050)).not.toThrow();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['bare Spanish', 'es'],
    ['Latin-American Spanish (no single country)', 'es-419'],
    ['unknown Spanish region', 'es-XX'],
    ['dangling hyphen', 'es-'],
    ['no language', '-AR'],
    ['region only', 'AR'],
    ['only hyphens', '---'],
    ['empty region slot', 'es--MX'.replace('MX', '')],
    ['French', 'fr-FR'],
    ['German', 'de-DE'],
    ['Chinese with script', 'zh-Hans-CN'],
  ])('falls back to es-AR / ARS: %s', (_label, language) => {
    expect(detectLocaleAndCurrency(language)).toEqual({ locale: 'es-AR', currency: 'ARS' });
  });

  it('keeps the Spanish locale for non-Spanish browsers but still guesses the currency from the region', () => {
    // The app is Spanish-only, so the interface language stays es-AR; the region only picks the currency.
    expect(detectLocaleAndCurrency('en-US')).toEqual({ locale: 'es-AR', currency: 'USD' });
    expect(detectLocaleAndCurrency('pt-BR')).toEqual({ locale: 'es-AR', currency: 'BRL' });
    expect(detectLocaleAndCurrency('en-ES')).toEqual({ locale: 'es-AR', currency: 'EUR' });
  });

  it('ignores private-use extensions after the region', () => {
    expect(detectLocaleAndCurrency('es-MX-x-private')).toEqual({ locale: 'es-MX', currency: 'MXN' });
  });

  it('always returns a pair Intl accepts, whatever the input', () => {
    const hostile = [
      '', ' ', '   ', '-', '_', '__', 'es-', 'es_', 'es--', '\n', 'es-\n', 'es-MX\n', ' es-MX', 'es-MX ', '😀', 'es-😀', 'es-É',
      'constructor', 'toString', '__proto__', 'es-constructor', 'es-__proto__', 'es-hasOwnProperty', 'es-toString',
      'a'.repeat(5000), `es-${'X'.repeat(5000)}`, 'es-MX'.repeat(500), 'null', 'undefined', '0', 'es-00', 'es-999',
    ];
    for (const language of hostile) {
      const { locale, currency } = detectLocaleAndCurrency(language);
      expect(CURRENCIES.map((c) => c.code)).toContain(currency);
      expect(() => getMoneyFormatter(locale, currency)).not.toThrow();
    }
  });
});

// ---- isSupportedCurrency ----------------------------------------------------

describe('isSupportedCurrency', () => {
  it.each(['ARS', 'USD', 'EUR', 'MXN', 'JPY', 'GBP', 'CHF', 'BRL'])('accepts the real code %s', (code) => {
    expect(isSupportedCurrency(code)).toBe(true);
  });

  it('accepts any well-formed three-letter code, real or not (Intl only checks the shape)', () => {
    expect(isSupportedCurrency('XYZ')).toBe(true);
    expect(isSupportedCurrency('ZZZ')).toBe(true);
  });

  it.each([
    ['lowercase', 'ars'],
    ['mixed case', 'Ars'],
    ['two letters', 'AR'],
    ['four letters', 'ARSS'],
    ['empty', ''],
    ['leading space', ' ARS'],
    ['trailing space', 'ARS '],
    ['trailing newline', 'ARS\n'],
    ['digit', 'A1S'],
    ['digits only', '123'],
    ['accent', 'ÁRS'],
    ['NUL', 'ARS\u0000'],
    ['symbol', '$'],
    ['punctuation', 'AR$'],
  ])('rejects %s', (_label, code) => {
    expect(isSupportedCurrency(code)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 840],
    ['an object', {}],
    ['an array', ['ARS']],
    ['a boxed String', new String('ARS')],
    ['a function', () => 'ARS'],
    ['true', true],
  ])('rejects %s without throwing', (_label, value) => {
    expect(isSupportedCurrency(value)).toBe(false);
  });
});

// ---- parseAmountText --------------------------------------------------------

describe('parseAmountText', () => {
  it.each([
    // Spanish style: "." groups thousands, "," is the decimal mark
    ['12.500,50', 1_250_050],
    ['12.500', 1_250_000],
    ['1.250', 125_000],
    ['1.000.000', 100_000_000],
    ['1.000.000,99', 100_000_099],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12,05', 1205],
    ['0,05', 5],
    ['0,5', 50],
    ['0,50', 50],
    [',5', 50],
    [',05', 5],
    // plain digits
    ['1250', 125_000],
    ['12500', 1_250_000],
    ['999', 99_900],
    ['007', 700],
    ['0', 0],
    ['00', 0],
    ['0,00', 0],
    // English style: "," groups thousands, "." is the decimal mark
    ['12,500.50', 1_250_050],
    ['12500.5', 1_250_050],
    ['12500.50', 1_250_050],
    ['1,200', 120_000],
    ['1,200.5', 120_050],
    ['1,234,567', 123_456_700],
    ['1,234,567.89', 123_456_789],
    ['.5', 50],
    ['.05', 5],
    ['0.05', 5],
    ['0.5', 50],
    // a dangling separator after a whole number
    ['5.', 500],
    ['5,', 500],
  ])('parses %j as %i cents', (text, expected) => {
    expect(parseAmountText(text)).toBe(expected);
  });

  it('treats exactly three digits after the last separator as thousands grouping, not decimals', () => {
    expect(parseAmountText('1.250')).toBe(125_000);
    expect(parseAmountText('1,250')).toBe(125_000);
    expect(parseAmountText('12.345')).toBe(1_234_500);
    expect(parseAmountText('999.999')).toBe(99_999_900);
  });

  it.each([
    ['$ 12.500,50', 1_250_050],
    ['$12.500,50', 1_250_050],
    ['ARS 1.250,75', 125_075],
    ['US$ 5', 500],
    ['€ 3,99', 399],
    ['R$ 1.234,56', 123_456],
    ['  12  ', 1200],
    ['12 pesos', 1200],
    ['1 250', 125_000],
    ['1 250,75', 125_075],
    ['1 250,75', 125_075],
    ['1 234 567,89', 123_456_789],
    ['\t12,50\n', 1250],
    ['Gs. 15.000', 1_500_000],
    ['Bs. 1.200', 120_000],
  ])('ignores currency symbols, words and spacing: %j', (text, expected) => {
    expect(parseAmountText(text)).toBe(expected);
  });

  it.each([
    [''],
    [' '],
    ['abc'],
    ['.'],
    [','],
    ['.,'],
    [',,'],
    ['$'],
    ['ARS'],
    ['--'],
    ['٣٤٥'], // Arabic-Indic digits
    ['１２３'], // fullwidth digits
    ['😀'],
    ['$ .'],
    ['\n'],
  ])('returns null when there is no digit: %j', (text) => {
    expect(parseAmountText(text)).toBeNull();
  });

  it.each([['12,3456'], ['1.2345'], ['0,0001'], ['12,34567'], ['1234567.8901']])('returns null for more than three decimals: %j', (text) => {
    expect(parseAmountText(text)).toBeNull();
  });

  it('returns 0 (not null) for an explicit zero, so callers must reject it themselves', () => {
    expect(parseAmountText('0')).toBe(0);
  });

  describe('size limits', () => {
    it('accepts the largest amount that is still a safe integer of cents', () => {
      expect(parseAmountText('90071992547409,91')).toBe(Number.MAX_SAFE_INTEGER);
      expect(parseAmountText('90.071.992.547.409,91')).toBe(Number.MAX_SAFE_INTEGER);
    });

    it.each([['90071992547409,92'], ['9007199254740993'], ['99999999999999999999'], ['1'.repeat(400)], ['9'.repeat(100_000)]])(
      'returns null instead of an unsafe number: %.30s',
      (text) => {
        expect(parseAmountText(text)).toBeNull();
      },
    );
  });

  describe('properties', () => {
    it('reads a whole number back however it is grouped, with or without cents', () => {
      for (const n of [0, 7, 99, 999, 1000, 1234, 99_999, 100_000, 1_234_567, 123_456_789_012]) {
        expect(parseAmountText(String(n))).toBe(n * 100);
        expect(parseAmountText(group(n, '.'))).toBe(n * 100);
        expect(parseAmountText(group(n, ','))).toBe(n * 100);
        expect(parseAmountText(`${group(n, '.')},07`)).toBe(n * 100 + 7);
        expect(parseAmountText(`${group(n, ',')}.07`)).toBe(n * 100 + 7);
        expect(parseAmountText(`${group(n, '.')},5`)).toBe(n * 100 + 50);
        expect(parseAmountText(`${group(n, ',')}.5`)).toBe(n * 100 + 50);
      }
    });

    it('always gives null or a non-negative safe integer, and never throws, for random junk', () => {
      const rng = mulberry32(99);
      const alphabet = '0123456789.,.,  $-+abcARS€ \n';
      const bad: string[] = [];
      for (let i = 0; i < 5000; i++) {
        let text = '';
        const length = Math.floor(rng() * 14);
        for (let j = 0; j < length; j++) text += alphabet[Math.floor(rng() * alphabet.length)] ?? '';
        const result = parseAmountText(text);
        if (result !== null && !(Number.isSafeInteger(result) && result >= 0)) bad.push(text);
      }
      expect(bad).toEqual([]);
    });

    // Every locale the app can detect, except Paraguay (see the known defects below).
    const ROUND_TRIP_LOCALES: Array<[string, string]> = [
      ['es-AR', 'ARS'], ['es-ES', 'EUR'], ['es-MX', 'MXN'], ['es-CL', 'CLP'], ['es-CO', 'COP'], ['es-UY', 'UYU'],
      ['es-PE', 'PEN'], ['es-BO', 'BOB'], ['es-BR', 'BRL'], ['es-US', 'USD'], ['es-EC', 'USD'], ['es-PA', 'USD'],
      ['es-SV', 'USD'], ['es-PR', 'USD'], ['es-CR', 'CRC'], ['es-GT', 'GTQ'], ['es-DO', 'DOP'], ['en-US', 'USD'],
    ];

    it.each(ROUND_TRIP_LOCALES)('reads back what the formatter writes (%s / %s)', (locale, currency) => {
      const f = getMoneyFormatter(locale, currency);
      const rng = mulberry32(2026);
      const amounts = [0, 1, 5, 99, 100, 101, 150, 999, 1000, 1234, 99_999, 100_000, 123_450, 1_250_000, 1_250_050, 99_999_999];
      for (let i = 0; i < 300; i++) amounts.push(Math.floor(rng() * 1_000_000_000_000));
      const wrong: string[] = [];
      for (const cents of amounts) {
        const text = f.format(cents);
        if (parseAmountText(text) !== cents) wrong.push(`${cents} -> ${JSON.stringify(flat(text))} -> ${parseAmountText(text)}`);
      }
      expect(wrong).toEqual([]);
    });

    it('reads back the whole-unit and number-only formats of es-AR', () => {
      const f = getMoneyFormatter('es-AR', 'ARS');
      for (const units of [0, 1, 12, 999, 1000, 12_345, 245_300, 9_999_999]) {
        expect(parseAmountText(f.formatNumber(units * 100))).toBe(units * 100);
        expect(parseAmountText(f.formatRounded(units * 100))).toBe(units * 100);
      }
    });
  });
});

// ---- known defects ----------------------------------------------------------

describe('known defects', () => {
  describe('parseAmountText turns a trailing separator after the decimals into a 100x amount', () => {
    // Either the intended value or null is acceptable; 100x too much is not.
    it.each([
      ['12,50,', 1250],
      ['12.50.', 1250],
      ['1250,50,', 125_050],
      ['$1.200,00.', 120_000],
      ['Pagué 12,50.', 1250],
      ['Total: $ 1.250,75.', 125_075],
    ])('%j', (text, intended) => {
      expect([intended, null]).toContain(parseAmountText(text));
    });
  });

  describe('parseAmountText reads the dot of a currency abbreviation as a decimal mark', () => {
    // "Gs.", "Bs.", "S/.", "Q." are how these currencies are written; amounts of one or two digits
    // come out 100x too small, and four or more digits come out as null.
    it.each([
      ['Gs. 5', 500],
      ['Gs. 12', 1200],
      ['Gs. 5000', 500_000],
      ['Bs. 50', 5000],
      ['S/. 50', 5000],
      ['Q. 50', 5000],
    ])('%j', (text, expected) => {
      expect(parseAmountText(text)).toBe(expected);
    });

    it('reads back what the app itself writes for Paraguayan guaraníes (es-PY / PYG prints "Gs. 12")', () => {
      const f = getMoneyFormatter('es-PY', 'PYG');
      const wrong: string[] = [];
      for (const cents of [100, 500, 1200, 5000, 15_000, 150_000, 1_500_000, 1_250_050]) {
        const text = f.format(cents);
        if (parseAmountText(text) !== cents) wrong.push(`${cents} -> ${JSON.stringify(flat(text))} -> ${parseAmountText(text)}`);
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('negative zero is printed as "-$ 0" / "-0"', () => {
    // Amounts such as a budget overrun of a few cents round to zero but keep Intl's minus sign.
    const f = getMoneyFormatter('es-AR', 'ARS');

    it.each([[-1], [-30], [-49], [-50]])('formatRounded(%i) reads like zero', (cents) => {
      expect(flat(f.formatRounded(cents))).toBe(flat(f.formatRounded(0)));
    });

    it.each([[-1], [-30], [-49], [-50]])('formatNumber(%i) reads like zero', (cents) => {
      expect(f.formatNumber(cents)).toBe(f.formatNumber(0));
    });
  });

  it('detectLocaleAndCurrency reads a script subtag as the region ("es-Latn-MX" should be Mexico)', () => {
    expect(detectLocaleAndCurrency('es-Latn-MX')).toEqual({ locale: 'es-MX', currency: 'MXN' });
  });
});
