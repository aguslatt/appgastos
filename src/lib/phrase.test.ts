import { describe, expect, it } from 'vitest';
import { parseExpensePhrase } from './phrase';

// 2026-10-02 is a Friday.
const TODAY = '2026-10-02';
const parse = (text: string) => parseExpensePhrase(text, TODAY);

describe('amounts written with digits', () => {
  it.each([
    ['uber 4500', 450_000],
    ['$3.500 super', 350_000],
    ['super 12.500,50', 1_250_050],
    ['3500 pesos nafta', 350_000],
    ['1.250', 125_000],
    ['café 2,5', 250],
    ['3,5k nafta', 350_000],
    ['2 lucas el uber', 200_000],
    ['un palo alquiler', 100_000_000],
    ['2,5 millones auto', 250_000_000],
    ['pizza 3 mil 500', 350_000],
    ['pizza 3 mil', 300_000],
  ])('"%s" -> %i cents', (text, cents) => {
    expect(parse(text).amount).toBe(cents);
  });

  it('keeps a quantity next to the item and takes the largest number as the price', () => {
    expect(parse('2 cafes 5000')).toMatchObject({ amount: 500_000, concept: '2 cafes' });
  });

  it('finds no amount when there is none', () => {
    expect(parse('propina')).toMatchObject({ amount: null, concept: 'propina' });
    expect(parse('un café')).toMatchObject({ amount: null, concept: 'café' }); // leading article trimmed
  });
});

describe('amounts spelled out (voice)', () => {
  it.each([
    ['tres mil quinientos propina', 350_000],
    ['dos mil farmacia', 200_000],
    ['mil pesos kiosco', 100_000],
    ['veinte mil alquiler', 2_000_000],
    ['treinta y cinco mil super', 3_500_000],
    ['ciento cincuenta nafta', 15_000],
    ['tres lucas taxi', 300_000],
    ['dos millones auto', 200_000_000],
  ])('"%s" -> %i cents', (text, cents) => {
    expect(parse(text).amount).toBe(cents);
  });

  it('does not mistake "un" or "una" for an amount', () => {
    expect(parse('una pizza').amount).toBeNull();
  });
});

describe('concept', () => {
  it('drops filler verbs and connectors around the amount', () => {
    expect(parse('gasté 3500 en propina')).toMatchObject({ amount: 350_000, concept: 'propina' });
    expect(parse('propina de 3500')).toMatchObject({ amount: 350_000, concept: 'propina' });
    expect(parse('Pagué $12.000 de luz')).toMatchObject({ amount: 1_200_000, concept: 'luz' });
  });

  it('keeps inner connectors', () => {
    expect(parse('café con leche 2500')).toMatchObject({ amount: 250_000, concept: 'café con leche' });
  });

  it('handles empty input', () => {
    expect(parse('')).toEqual({ amount: null, concept: '', date: null });
    expect(parse('   ')).toEqual({ amount: null, concept: '', date: null });
  });
});

describe('dates', () => {
  it.each([
    ['gasté 3500 en propina ayer', '2026-10-01'],
    ['ayer farmacia 3200', '2026-10-01'],
    ['anoche cena 8000', '2026-10-01'],
    ['anteayer 500 kiosco', '2026-09-30'],
    ['antes de ayer 500 kiosco', '2026-09-30'],
    ['hoy uber 1000', '2026-10-02'],
    ['cena del sábado 18000', '2026-09-26'],
    ['el lunes nafta 20000', '2026-09-28'],
    ['el viernes super 5000', '2026-10-02'],
  ])('"%s" -> %s', (text, date) => {
    expect(parse(text).date).toBe(date);
  });

  it('removes the date words from the concept', () => {
    expect(parse('cena del sábado 18000')).toMatchObject({ concept: 'cena', amount: 1_800_000 });
    expect(parse('antes de ayer 500 kiosco')).toMatchObject({ concept: 'kiosco' });
  });

  it('leaves the date empty when none is named', () => {
    expect(parse('uber 4500').date).toBeNull();
  });
});
