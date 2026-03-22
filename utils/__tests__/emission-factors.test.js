// backend/utils/__tests__/emission-factors.test.js
'use strict';
const { rawToMwh, mwhToTco2, REGION_BASELINE_2005, ALTO_TAMEGA_MUNICIPIOS } = require('../emission-factors');

describe('rawToMwh', () => {
  test('electricity: kWh → MWh (× 0.001)', () => {
    expect(rawToMwh(1, 'total', 1000)).toBeCloseTo(1.0);
  });
  test('gas: 10³Nm³ → MWh (× 10.55)', () => {
    expect(rawToMwh(2, 'total', 1)).toBeCloseTo(10.55);
  });
  test('oil Gasóleo Rodoviário: ton → MWh (× 11.94)', () => {
    expect(rawToMwh(3, 'Gasóleo Rodoviário', 1)).toBeCloseTo(11.94);
  });
  test('oil unknown product uses default factor 11.63', () => {
    expect(rawToMwh(3, 'Produto Desconhecido', 1)).toBeCloseTo(11.63);
  });
  test('returns 0 for NaN input', () => {
    expect(rawToMwh(1, 'total', 'abc')).toBe(0);
  });
});

describe('mwhToTco2', () => {
  test('electricity: 1 MWh → 0.255 tCO2e', () => {
    expect(mwhToTco2(1, 1)).toBeCloseTo(0.255);
  });
  test('gas: 1 MWh → 0.202 tCO2e', () => {
    expect(mwhToTco2(2, 1)).toBeCloseTo(0.202);
  });
  test('oil: 1 MWh → 0.267 tCO2e', () => {
    expect(mwhToTco2(3, 1)).toBeCloseTo(0.267);
  });
});

describe('constants', () => {
  test('REGION_BASELINE_2005 is 280000', () => {
    expect(REGION_BASELINE_2005).toBe(280000);
  });
  test('ALTO_TAMEGA_MUNICIPIOS has 6 entries', () => {
    expect(ALTO_TAMEGA_MUNICIPIOS).toHaveLength(6);
  });
});
