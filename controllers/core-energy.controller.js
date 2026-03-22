// backend/controllers/core-energy.controller.js
'use strict';

const pool = require('../util/db');
const {
  REGION_BASELINE_2005, ALTO_TAMEGA_MUNICIPIOS,
  rawToMwh, mwhToTco2,
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
    const mwh = rawToMwh(Number(row.type), row.sub_type_descr, row.total);
    if (row.type === 1) electricity_mwh += mwh;
    else if (row.type === 2) gas_mwh += mwh;
    else if (row.type === 3) oil_mwh += mwh;
  }
  return {
    electricity_mwh: Math.round(electricity_mwh),
    gas_mwh: Math.round(gas_mwh),
    oil_mwh: Math.round(oil_mwh),
    total_mwh: Math.round(electricity_mwh + gas_mwh + oil_mwh),
  };
}

function aggregateGee(energyByVector) {
  const electricity_tco2 = Math.round(mwhToTco2(1, energyByVector.electricity_mwh));
  const gas_tco2 = Math.round(mwhToTco2(2, energyByVector.gas_mwh));
  const oil_tco2 = Math.round(mwhToTco2(3, energyByVector.oil_mwh));
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
    if (!yearMap[y]) yearMap[y] = { year: y, electricity_mwh: null, gas_mwh: null, oil_mwh: null };
    const mwh = rawToMwh(Number(row.type), row.sub_type_descr, row.total);
    if (row.type === 1) yearMap[y].electricity_mwh = Math.round((yearMap[y].electricity_mwh || 0) + mwh);
    else if (row.type === 2) yearMap[y].gas_mwh = Math.round((yearMap[y].gas_mwh || 0) + mwh);
    else if (row.type === 3) yearMap[y].oil_mwh = Math.round((yearMap[y].oil_mwh || 0) + mwh);
  }
  return Object.values(yearMap).sort((a, b) => a.year - b.year);
}

function buildEnergyBySector(rows) {
  const sectorMap = {};
  for (const row of rows) {
    const mwh = rawToMwh(Number(row.type), row.sub_type_descr, row.total);
    sectorMap[row.sector] = (sectorMap[row.sector] || 0) + mwh;
  }
  return Object.entries(sectorMap)
    .map(([sector, mwh]) => ({ sector, mwh: Math.round(mwh) }))
    .sort((a, b) => b.mwh - a.mwh);
}

async function summary(req, res) {
  try {
    const municipioId = req.query.municipio ? parseInt(req.query.municipio, 10) : null;
    const municipioNames = await getMunicipioNames(municipioId);

    // Find latest year with data per type
    const { rows: latestYears } = await pool.query(
      'SELECT type, MAX(year) AS max_year FROM metrics_municipio WHERE municipio = ANY($1) GROUP BY type',
      [municipioNames]
    );
    const yearToUse = req.query.year
      ? parseInt(req.query.year, 10)
      : (latestYears.find(r => r.type === 1)?.max_year || Math.max(...latestYears.map(r => r.max_year), 0) || null);

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
           AND mm.value ~ '^[0-9]+\\.?[0-9]*$'
           AND NOT (mm.type = 1 AND mm.sub_type != 4)
         GROUP BY mm.year, mm.type, mm.sub_type, st.descr ORDER BY mm.year ASC`,
        [municipioNames]
      ),
      pool.query(
        `SELECT ct.descr AS sector, mm.type, mm.sub_type, st.descr AS sub_type_descr, SUM(mm.value::numeric) AS total
         FROM metrics_municipio mm
         JOIN consumer_types ct ON ct.id = mm.consumer_type
         JOIN sub_types st ON st.id = mm.sub_type
         WHERE mm.municipio = ANY($1) AND mm.year = $2
           AND mm.value ~ '^[0-9]+\\.?[0-9]*$'
           AND NOT (mm.type = 1 AND mm.sub_type != 4)
         GROUP BY ct.descr, mm.type, mm.sub_type, st.descr ORDER BY total DESC`,
        [municipioNames, yearToUse]
      ),
      pool.query('SELECT MAX(synced_at) AS last_sync FROM dgeg_sync'),
    ]);

    const energyByVector = aggregateByVector(vectorRows.rows);
    const geeByVector = aggregateGee(energyByVector);
    const energyByYear = buildEnergyByYear(yearRows.rows);
    const energyBySector = buildEnergyBySector(sectorRows.rows);

    res.json({
      latestYear: yearToUse,
      baseline2005_tco2: REGION_BASELINE_2005,
      energyByVector,
      geeByVector,
      energyByYear,
      energyBySector,
      lastSync: syncRow.rows[0]?.last_sync ?? null,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { summary };
