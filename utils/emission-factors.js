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
const EMISSION_FACTORS_MWH = {
  electricity: 0.255,
  gas: 0.202,
  oil: 0.267,
};

const REGION_BASELINE_2005 = 280000; // tCO2e, Alto Tâmega e Barroso PMAC

const ALTO_TAMEGA_MUNICIPIOS = [
  'Boticas', 'Chaves', 'Montalegre',
  'Ribeira de Pena', 'Valpaços', 'Vila Pouca de Aguiar',
];

function rawToMwh(type, subTypeDescr, rawValue) {
  const v = parseFloat(rawValue);
  if (isNaN(v)) return 0;
  if (type === 1) return v * 0.001;
  if (type === 2) return v * 10.55;
  if (type === 3) return v * (OIL_MWH_PER_TON[subTypeDescr] ?? OIL_MWH_PER_TON.default);
  return 0;
}

function mwhToTco2(type, mwh) {
  if (type === 1) return mwh * EMISSION_FACTORS_MWH.electricity;
  if (type === 2) return mwh * EMISSION_FACTORS_MWH.gas;
  if (type === 3) return mwh * EMISSION_FACTORS_MWH.oil;
  return 0;
}

module.exports = {
  OIL_MWH_PER_TON, EMISSION_FACTORS_MWH,
  REGION_BASELINE_2005, ALTO_TAMEGA_MUNICIPIOS,
  rawToMwh, mwhToTco2,
};
