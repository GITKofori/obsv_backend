// backend/controllers/core-energy.controller.js
'use strict';

const pool = require('../util/db');
const {
  REGION_BASELINE_2005, ALTO_TAMEGA_MUNICIPIOS,
  rawToMwh, mwhToTco2, getConsumerSector,
} = require('../utils/emission-factors');

async function getMunicipioNames(municipioId) {
  if (!municipioId) return ALTO_TAMEGA_MUNICIPIOS;
  const { rows } = await pool.query('SELECT nome FROM municipios WHERE id = $1', [municipioId]);
  if (!rows.length) throw Object.assign(new Error('Municipio not found'), { status: 404 });
  return [rows[0].nome];
}

function aggregateByVector(rows) {
  let electricity_mwh = 0, gas_mwh = 0, oil_mwh = 0;
  for (const row of rows) {
    const type = Number(row.type);
    const mwh = rawToMwh(type, row.sub_type_descr, row.total);
    if (type === 1) electricity_mwh += mwh;
    else if (type === 2) gas_mwh += mwh;
    else if (type === 3) oil_mwh += mwh;
  }
  return {
    electricity_mwh: Math.round(electricity_mwh),
    gas_mwh: Math.round(gas_mwh),
    oil_mwh: Math.round(oil_mwh),
    total_mwh: Math.round(electricity_mwh + gas_mwh + oil_mwh),
  };
}

function aggregateGee(energyByVector, year) {
  const electricity_tco2 = Math.round(mwhToTco2(1, energyByVector.electricity_mwh, year));
  const gas_tco2 = Math.round(mwhToTco2(2, energyByVector.gas_mwh, year));
  const oil_tco2 = Math.round(mwhToTco2(3, energyByVector.oil_mwh, year));
  return {
    electricity_tco2,
    gas_tco2,
    oil_tco2,
    total_tco2: electricity_tco2 + gas_tco2 + oil_tco2,
  };
}

function buildEnergyByYear(rows) {
  const yearMap = {};
  for (const row of rows) {
    const y = row.year;
    const type = Number(row.type);
    if (!yearMap[y]) yearMap[y] = { year: y, electricity_mwh: null, gas_mwh: null, oil_mwh: null };
    const mwh = rawToMwh(type, row.sub_type_descr, row.total);
    if (type === 1) yearMap[y].electricity_mwh = Math.round((yearMap[y].electricity_mwh || 0) + mwh);
    else if (type === 2) yearMap[y].gas_mwh = Math.round((yearMap[y].gas_mwh || 0) + mwh);
    else if (type === 3) yearMap[y].oil_mwh = Math.round((yearMap[y].oil_mwh || 0) + mwh);
  }
  return Object.values(yearMap).sort((a, b) => a.year - b.year);
}

function buildEnergyBySector(rows) {
  const sectorMap = {};
  for (const row of rows) {
    const mwh = rawToMwh(Number(row.type), row.sub_type_descr, row.total);
    const sector = getConsumerSector(Number(row.consumer_type_id));
    sectorMap[sector] = (sectorMap[sector] || 0) + mwh;
  }
  return Object.entries(sectorMap)
    .map(([sector, mwh]) => ({ sector, mwh: Math.round(mwh) }))
    .sort((a, b) => b.mwh - a.mwh);
}

function buildGeeEmissionsBySector(rows, year) {
  const sectorMap = {};
  for (const row of rows) {
    const type = Number(row.type);
    const mwh = rawToMwh(type, row.sub_type_descr, row.total);
    const tco2 = mwhToTco2(type, mwh, year, row.sub_type_descr);
    const sector = getConsumerSector(Number(row.consumer_type_id));
    sectorMap[sector] = (sectorMap[sector] || 0) + tco2;
  }
  return Object.entries(sectorMap)
    .map(([sector, tco2]) => ({ sector, tco2: Math.round(tco2) }))
    .sort((a, b) => b.tco2 - a.tco2);
}

function buildGeeByYear(rows) {
  const yearMap = {};
  for (const row of rows) {
    const y = row.year;
    const type = Number(row.type);
    if (!yearMap[y]) yearMap[y] = { year: y, electricity_tco2: 0, gas_tco2: 0, oil_tco2: 0 };
    const mwh = rawToMwh(type, row.sub_type_descr, row.total);
    const tco2 = mwhToTco2(type, mwh, y, row.sub_type_descr);
    if (type === 1) yearMap[y].electricity_tco2 += tco2;
    else if (type === 2) yearMap[y].gas_tco2 += tco2;
    else if (type === 3) yearMap[y].oil_tco2 += tco2;
  }
  return Object.values(yearMap)
    .map(y => ({
      year: y.year,
      electricity_tco2: Math.round(y.electricity_tco2),
      gas_tco2: Math.round(y.gas_tco2),
      oil_tco2: Math.round(y.oil_tco2),
      total_tco2: Math.round(y.electricity_tco2 + y.gas_tco2 + y.oil_tco2),
    }))
    .sort((a, b) => a.year - b.year);
}

async function summary(req, res) {
  try {
    const municipioId = req.query.municipio ? parseInt(req.query.municipio, 10) : null;
    const municipioNames = await getMunicipioNames(municipioId);

    // Fetch population and per-municipality baseline for per-capita and trajectory calculations
    const popRes = await pool.query(
      'SELECT SUM(populacao_base_2005) AS total_pop, SUM(emissoes_base_2005) AS baseline FROM municipios WHERE nome = ANY($1)',
      [municipioNames]
    );
    const population = Number(popRes.rows[0]?.total_pop) || null;
    const municipioBaseline2005 = Number(popRes.rows[0]?.baseline) || null;

    // Find latest year with data per type (only consider 2005+)
    const { rows: latestYears } = await pool.query(
      'SELECT type, MAX(year) AS max_year FROM metrics_municipio WHERE municipio = ANY($1) AND year >= 2005 GROUP BY type',
      [municipioNames]
    );
    const yearToUse = req.query.year
      ? parseInt(req.query.year, 10)
      : (latestYears.find(r => r.type === 1)?.max_year || Math.max(...latestYears.map(r => r.max_year), 0) || null);

    if (yearToUse === null) {
      return res.json({
        latestYear: null,
        baseline2005_tco2: REGION_BASELINE_2005,
        municipio_baseline_2005: municipioBaseline2005,
        population,
        gee_per_capita: null,
        energy_per_capita: null,
        energyByVector: { electricity_mwh: 0, gas_mwh: 0, oil_mwh: 0, total_mwh: 0 },
        geeByVector: { electricity_tco2: 0, gas_tco2: 0, oil_tco2: 0, total_tco2: 0 },
        energyByYear: [],
        geeByYear: [],
        energyBySector: [],
        geeBySector: [],
        lastSync: null,
      });
    }

    const MIN_YEAR = 2005;

    const [vectorRows, yearRows, sectorRows, syncRow] = await Promise.all([
      pool.query(
        `SELECT mm.type, mm.sub_type, st.descr AS sub_type_descr, SUM(mm.value::numeric) AS total
         FROM metrics_municipio mm JOIN sub_types st ON st.id = mm.sub_type
         WHERE mm.municipio = ANY($1) AND mm.year = $2
           AND mm.value ~ '^[0-9]+\\.?[0-9]*$'
           AND NOT (mm.type = 1 AND mm.sub_type != 4)
         GROUP BY mm.type, mm.sub_type, st.descr`,
        [municipioNames, yearToUse]
      ),
      pool.query(
        `SELECT mm.year, mm.type, mm.sub_type, st.descr AS sub_type_descr, SUM(mm.value::numeric) AS total
         FROM metrics_municipio mm JOIN sub_types st ON st.id = mm.sub_type
         WHERE mm.municipio = ANY($1)
           AND mm.year >= $2
           AND mm.value ~ '^[0-9]+\\.?[0-9]*$'
           AND NOT (mm.type = 1 AND mm.sub_type != 4)
         GROUP BY mm.year, mm.type, mm.sub_type, st.descr ORDER BY mm.year ASC`,
        [municipioNames, MIN_YEAR]
      ),
      pool.query(
        `SELECT mm.consumer_type AS consumer_type_id, ct.descr AS sector,
                mm.type, mm.sub_type, st.descr AS sub_type_descr, SUM(mm.value::numeric) AS total
         FROM metrics_municipio mm
         JOIN consumer_types ct ON ct.id = mm.consumer_type
         JOIN sub_types st ON st.id = mm.sub_type
         WHERE mm.municipio = ANY($1) AND mm.year = $2
           AND mm.value ~ '^[0-9]+\\.?[0-9]*$'
           AND NOT (mm.type = 1 AND mm.sub_type != 4)
         GROUP BY mm.consumer_type, ct.descr, mm.type, mm.sub_type, st.descr ORDER BY total DESC`,
        [municipioNames, yearToUse]
      ),
      pool.query('SELECT MAX(synced_at) AS last_sync FROM dgeg_sync'),
    ]);

    const energyByVector = aggregateByVector(vectorRows.rows);
    const geeByVector = aggregateGee(energyByVector, yearToUse);
    const energyByYear = buildEnergyByYear(yearRows.rows);
    const geeByYear = buildGeeByYear(yearRows.rows);
    const energyBySector = buildEnergyBySector(sectorRows.rows);
    const geeBySector = buildGeeEmissionsBySector(sectorRows.rows, yearToUse);

    const gee_per_capita = population && geeByVector.total_tco2 > 0
      ? Math.round((geeByVector.total_tco2 / population) * 100) / 100
      : null;

    const energy_per_capita = population && energyByVector.total_mwh > 0
      ? Math.round((energyByVector.total_mwh / population) * 100) / 100
      : null;

    res.json({
      latestYear: yearToUse,
      baseline2005_tco2: REGION_BASELINE_2005,
      municipio_baseline_2005: municipioBaseline2005,
      population,
      gee_per_capita,
      energy_per_capita,
      energyByVector,
      geeByVector,
      energyByYear,
      geeByYear,
      energyBySector,
      geeBySector,
      lastSync: syncRow.rows[0]?.last_sync ?? null,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
}

async function map(req, res) {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : 2023;
    const municipioNames = ALTO_TAMEGA_MUNICIPIOS;

    const [energyRows, medidasRows] = await Promise.all([
      pool.query(
        `SELECT mm.municipio, mm.type, mm.sub_type, st.descr AS sub_type_descr,
                SUM(mm.value::numeric) AS total
         FROM metrics_municipio mm JOIN sub_types st ON st.id = mm.sub_type
         WHERE mm.municipio = ANY($1) AND mm.year = $2
           AND mm.value ~ '^[0-9]+\\.?[0-9]*$'
           AND NOT (mm.type = 1 AND mm.sub_type != 4)
         GROUP BY mm.municipio, mm.type, mm.sub_type, st.descr`,
        [municipioNames, year]
      ),
      pool.query(
        `SELECT mu.nome, COUNT(m.id) AS medidas_count
         FROM municipios mu LEFT JOIN medidas m ON m.fk_municipio = mu.id
         WHERE mu.nome = ANY($1)
         GROUP BY mu.nome`,
        [municipioNames]
      ),
    ]);

    // Build per-municipality aggregates
    const munMap = {};
    for (const mun of municipioNames) {
      munMap[mun] = { municipio: mun, energia_mwh: 0, gee_tco2: 0, medidas_count: 0 };
    }

    for (const row of energyRows.rows) {
      const type = Number(row.type);
      const mwh = rawToMwh(type, row.sub_type_descr, row.total);
      const tco2 = mwhToTco2(type, mwh, year);
      if (munMap[row.municipio]) {
        munMap[row.municipio].energia_mwh += mwh;
        munMap[row.municipio].gee_tco2 += tco2;
      }
    }
    for (const row of medidasRows.rows) {
      if (munMap[row.nome]) munMap[row.nome].medidas_count = Number(row.medidas_count);
    }

    // Round
    for (const mun of Object.values(munMap)) {
      mun.energia_mwh = Math.round(mun.energia_mwh);
      mun.gee_tco2 = Math.round(mun.gee_tco2);
    }

    res.json(Object.values(munMap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { summary, map };
