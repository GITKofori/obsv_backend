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
  electricity: 0.288, // kept for reference (2019 T2 value); use getElectricityEF(year) for accurate values
  gas: 0.202,
  oil: 0.267,
};

// Year-variable electricity grid emission factors (tCO2 eq./MWh)
// Source: APA "Fator de Emissão da Eletricidade 2025" (T2. Média móvel de 5 anos, Continente)
// URL: https://apambiente.pt/sites/default/files/_Clima/Inventarios/20250808/fe_gee_eletricidade_2025_final_apc.pdf
const ELECTRICITY_EF_BY_YEAR = {
  2005: 0.480,
  2006: 0.476,
  2007: 0.448,
  2008: 0.442,
  2009: 0.421,
  2010: 0.365,
  2011: 0.337,
  2012: 0.328,
  2013: 0.303,
  2014: 0.280,
  2015: 0.297,
  2016: 0.292,
  2017: 0.291,
  2018: 0.295,
  2019: 0.289,
  2020: 0.258,
  2021: 0.233,
  2022: 0.194,
  2023: 0.156,
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
// Keys are actual DB IDs from consumer_types, NOT CAE numbers.
const CONSUMER_TYPE_TO_SECTOR = {
  // Agricultura e Usos Solo: CAE 01, 02, 03
  107: 'Agricultura e Usos Solo', // Agricultura, produção animal, caça
  106: 'Agricultura e Usos Solo', // Silvicultura e exploração florestal
  105: 'Agricultura e Usos Solo', // Pesca e aquicultura

  // Indústria: CAE 07-33 (except 35), 36
  104: 'Indústria', // Extracção e preparação de minérios metálicos
  103: 'Indústria', // Outras indústrias extractivas
  102: 'Indústria', // Actividades dos serviços relacionados com as indústrias extractivas
  101: 'Indústria', // Indústrias alimentares
  100: 'Indústria', // Indústria das bebidas
  99: 'Indústria',  // Indústria do tabaco
  98: 'Indústria',  // Fabricação de têxteis
  97: 'Indústria',  // Indústria do vestuário
  96: 'Indústria',  // Indústria do couro
  95: 'Indústria',  // Indústrias da madeira e da cortiça
  94: 'Indústria',  // Fabricação de pasta, de papel, de cartão
  93: 'Indústria',  // Impressão e reprodução de suportes gravados
  92: 'Indústria',  // Fabricação de coque, produtos petrolíferos refinados
  91: 'Indústria',  // Fabricação de produtos químicos
  90: 'Indústria',  // Fabricação de produtos farmacêuticos
  89: 'Indústria',  // Fabricação de artigos de borracha e matérias plásticas
  88: 'Indústria',  // Fabrico de outros produtos minerais não metálicos
  87: 'Indústria',  // Indústrias metalúrgicas de base
  86: 'Indústria',  // Fabricação de produtos metálicos
  85: 'Indústria',  // Fabricação de equipamentos informáticos
  84: 'Indústria',  // Fabricação de equipamento eléctrico
  83: 'Indústria',  // Fabricação de máquinas e de equipamentos
  82: 'Indústria',  // Fabricação de veículos automóveis
  81: 'Indústria',  // Fabricação de outro equipamento de transporte
  80: 'Indústria',  // Fabrico de mobiliário e de colchões
  79: 'Indústria',  // Outras indústrias transformadoras
  78: 'Indústria',  // Reparação, manutenção e instalação de máquinas
  76: 'Indústria',  // Captação, tratamento e distribuição de água

  // Energia: CAE 35
  77: 'Energia', // Electricidade, gás, vapor, água quente e fria e ar frio

  // Resíduos e Águas residuais: CAE 37, 38
  75: 'Resíduos e Águas residuais', // Recolha, drenagem e tratamento de águas residuais
  74: 'Resíduos e Águas residuais', // Recolha, tratamento e eliminação de resíduos
  73: 'Resíduos e Águas residuais', // Descontaminação e actividades similares

  // Transportes: CAE 49-51
  66: 'Transportes', // Transportes terrestres e por oleodutos ou gasodutos
  65: 'Transportes', // Transportes por água
  110: 'Transportes', // Transportes aéreos
  64: 'Transportes', // Armazenagem e actividades auxiliares dos transportes

  // Edifícios (Residencial): Consumo doméstico
  25: 'Edifícios (Residencial)', // Consumo doméstico

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
