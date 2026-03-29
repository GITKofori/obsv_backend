// backend/utils/emission-factors.js
'use strict';

// Petroleum lower heating values (MWh/ton), DGEG/IPCC standard
const OIL_MWH_PER_TON = {
  'Butano': 12.78,
  'Propano': 12.88,
  'Gás Auto': 11.63,
  'Gasolina IO 95': 12.17,
  'Gasolina IO 98': 12.17,
  'Nafta Química e Aromáticos': 10.3,
  'Nafta Química': 10.3,
  'Matéria Prima Aromáticos': 10.3,
  'Petróleo Iluminante / Carburante': 11.9,
  'Gasóleo Rodoviário': 11.94,
  'Gasóleo Colorido': 11.94,
  'Gasóleo Colorido p/ Aquecimento': 11.94,
  'Fuelóleo': 11.63,
  'Fuel': 11.63,
  'Coque de Petróleo': 8.14,
  'Lubrificantes': 11.1,
  'Asfaltos': 9.8,
  'Parafinas': 11.7,
  'Solventes': 10.9,
  'Biodiesel': 10.6,
  'Benzinas': 10.5,
  'Enxofre': 4.0,
  'Outros': 11.63,
  'default': 11.63,
};

// tCO2e per MWh — Portuguese national standard factors (APA/IPCC)
// Gas and oil combustion factors are relatively stable, so those remain fixed.
const EMISSION_FACTORS_MWH = {
  electricity: 0.255, // kept for reference; use getElectricityEF(year) for accurate values
  gas: 0.202,
  oil: 0.267,
};

// Year-variable electricity grid emission factors (tCO2 eq./MWh)
// Source: Client calculations spreadsheet (T1. Fator de Emissão de Eletricidade – Anual, Continente)
const ELECTRICITY_EF_BY_YEAR = {
  2005: 0.527,
  2006: 0.433,
  2007: 0.393,
  2008: 0.386,
  2009: 0.366,
  2010: 0.245,
  2011: 0.294,
  2012: 0.346,
  2013: 0.262,
  2014: 0.254,
  2015: 0.328,
  2016: 0.267,
  2017: 0.338,
  2018: 0.282,
  2019: 0.224,
  2020: 0.175,
};

function getElectricityEF(year) {
  if (ELECTRICITY_EF_BY_YEAR[year]) return ELECTRICITY_EF_BY_YEAR[year];
  // Fallback: use closest available year
  const years = Object.keys(ELECTRICITY_EF_BY_YEAR).map(Number).sort((a, b) => a - b);
  if (year < years[0]) return ELECTRICITY_EF_BY_YEAR[years[0]];
  if (year > years[years.length - 1]) return ELECTRICITY_EF_BY_YEAR[years[years.length - 1]];
  // Find closest
  let closest = years[0];
  for (const y of years) {
    if (Math.abs(y - year) < Math.abs(closest - year)) closest = y;
  }
  return ELECTRICITY_EF_BY_YEAR[closest];
}

const REGION_BASELINE_2005 = 280000; // tCO2e, Alto Tâmega e Barroso PMAC

// PMAC reduction milestones vs 2005 baseline
const PMAC_MILESTONES = [
  { year: 2005, factor: 1.0 },
  { year: 2030, factor: 0.45 },    // -55%
  { year: 2040, factor: 0.35 },    // -65% (conservative)
  { year: 2050, factor: 0.10 },    // -90%
];

const PMAC_MILESTONES_AMBITIOUS = [
  { year: 2005, factor: 1.0 },
  { year: 2030, factor: 0.45 },    // -55%
  { year: 2040, factor: 0.25 },    // -75% (ambitious)
  { year: 2050, factor: 0.10 },    // -90%
];

const ALTO_TAMEGA_MUNICIPIOS = [
  'Boticas', 'Chaves', 'Montalegre',
  'Ribeira de Pena', 'Valpaços', 'Vila Pouca de Aguiar',
];

// Fossil fuel emission factors (IPCC, tCO2 eq./MWh)
// Source: Client calculations spreadsheet — Fatores de emissão combustíveis fósseis
const OIL_EMISSION_FACTORS_MWH = {
  'Gasóleo Rodoviário': 0.268,
  'Gasóleo Colorido': 0.268,
  'Gasóleo Colorido p/ Aquecimento': 0.268,
  'Gasolina IO 95': 0.250,
  'Gasolina IO 98': 0.250,
  'Butano': 0.227,
  'Propano': 0.227,
  'Gás Auto': 0.227,
  'Fuelóleo': 0.268,
  'Fuel': 0.268,
  'default': 0.267,
};

/**
 * Convert raw DGEG value to MWh.
 * Raw units per type (from DGEG source files):
 *   type 1 (electricity): kWh         → × 0.001 = MWh
 *   type 2 (gas):         10³ Nm³     → × 10.55 = MWh  (1 Nm³ ≈ 0.01055 MWh)
 *   type 3 (oil):         tonnes      → × product-specific MWh/ton factor
 */
function rawToMwh(type, subTypeDescr, rawValue) {
  const v = parseFloat(rawValue);
  if (isNaN(v)) return 0;
  if (type === 1) return v * 0.001;
  if (type === 2) return v * 10.55;
  if (type === 3) return v * (OIL_MWH_PER_TON[subTypeDescr] ?? OIL_MWH_PER_TON.default);
  return 0;
}

/**
 * Convert MWh to tCO2 equivalent.
 * @param {number} type - 1=electricity, 2=gas, 3=oil
 * @param {number} mwh
 * @param {number} [year] - Required for electricity (year-variable factor)
 * @param {string} [subTypeDescr] - Oil product name for product-specific EF
 */
function mwhToTco2(type, mwh, year, subTypeDescr) {
  if (type === 1) return mwh * getElectricityEF(year || 2019);
  if (type === 2) return mwh * EMISSION_FACTORS_MWH.gas;
  if (type === 3) return mwh * (OIL_EMISSION_FACTORS_MWH[subTypeDescr] ?? OIL_EMISSION_FACTORS_MWH.default);
  return 0;
}

// Maps consumer_type IDs (from consumer_types table) to 7 PMAC sectors.
// Based on client specification mapping CAE codes → sectors.
const CONSUMER_TYPE_TO_SECTOR = {
  // Agricultura e Usos Solo: CAE 01, 02, 03
  1: 'Agricultura e Usos Solo',
  2: 'Agricultura e Usos Solo',
  3: 'Agricultura e Usos Solo',

  // Indústria: CAE 07-33 (except 35), 36
  7: 'Indústria',
  8: 'Indústria',
  9: 'Indústria',
  10: 'Indústria',
  11: 'Indústria',
  13: 'Indústria',
  14: 'Indústria',
  15: 'Indústria',
  16: 'Indústria',
  18: 'Indústria',
  19: 'Indústria',
  20: 'Indústria',
  22: 'Indústria',
  23: 'Indústria',
  24: 'Indústria',
  25: 'Indústria',
  26: 'Indústria',
  28: 'Indústria',
  30: 'Indústria',
  31: 'Indústria',
  32: 'Indústria',
  33: 'Indústria',
  36: 'Indústria',

  // Energia: CAE 35
  35: 'Energia',

  // Resíduos e Águas residuais: CAE 37, 38
  37: 'Resíduos e Águas residuais',
  38: 'Resíduos e Águas residuais',

  // Transportes: CAE 49
  49: 'Transportes',

  // Edifícios (Residencial): CAE 98
  98: 'Edifícios (Residencial)',

  // Edifícios (Serviços): all remaining CAEs (default)
};

const DEFAULT_SECTOR = 'Edifícios (Serviços)';

function getConsumerSector(consumerTypeId) {
  return CONSUMER_TYPE_TO_SECTOR[consumerTypeId] || DEFAULT_SECTOR;
}

module.exports = {
  OIL_MWH_PER_TON, EMISSION_FACTORS_MWH, ELECTRICITY_EF_BY_YEAR, OIL_EMISSION_FACTORS_MWH,
  REGION_BASELINE_2005, PMAC_MILESTONES, PMAC_MILESTONES_AMBITIOUS, ALTO_TAMEGA_MUNICIPIOS,
  CONSUMER_TYPE_TO_SECTOR, DEFAULT_SECTOR,
  rawToMwh, mwhToTco2, getElectricityEF, getConsumerSector,
};
