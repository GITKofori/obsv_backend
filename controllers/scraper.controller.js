'use strict';
const { fork } = require('child_process');
const path = require('path');
const pool = require('../util/db');
const { parseManualCSV, validateRows } = require('../../scraper/sources/manual');
const { upsertLeitura } = require('../../scraper/utils/upsert');

async function run(req, res) {
  const { ano } = req.body;
  if (!ano || isNaN(Number(ano))) return res.status(400).json({ error: 'ano required' });
  const year = parseInt(ano, 10);
  if (year < 1990 || year > 2100) return res.status(400).json({ error: 'ano must be between 1990 and 2100' });

  // Fork the scraper as a child process — it creates its own scraper_run row.
  // We wait for the IPC message with the runId, then unref and respond immediately.
  const scraperPath = path.join(__dirname, '../../scraper/index.js');
  const child = fork(scraperPath, [String(year)], { env: { ...process.env } });

  try {
    const runId = await new Promise((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => reject(new Error('Scraper did not start within 10s')), 10_000);
      child.once('message', msg => {
        clearTimeout(timer);
        resolved = true;
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.runId);
      });
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('exit', code => {
        clearTimeout(timer);
        if (!resolved) reject(new Error(`Scraper exited (code ${code}) before sending runId`));
      });
    });
    child.unref();
    return res.json({ runId, message: `Scraper started for ${year}` });
  } catch (err) {
    if (child.exitCode === null && !child.killed) child.kill();
    return res.status(500).json({ error: err.message });
  }
}

async function getStatus(req, res) {
  const runId = parseInt(req.params.runId, 10);
  if (isNaN(runId)) return res.status(400).json({ error: 'Invalid runId' });
  try {
    const { rows } = await pool.query(
      'SELECT id, ano, status, started_at, finished_at, stats FROM scraper_runs WHERE id = $1',
      [runId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRuns(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, ano, status, started_at, finished_at, stats FROM scraper_runs WHERE source = 'iso' ORDER BY started_at DESC LIMIT 20"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadManual(req, res) {
  const csvString = req.body.csv;
  if (!csvString) return res.status(400).json({ error: 'csv field required' });

  let rows;
  try {
    rows = validateRows(parseManualCSV(csvString));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    for (const row of rows) {
      await upsertLeitura({
        fk_iso_indicador: row.iso_indicador_id,
        fk_municipio:     row.municipio_id,
        ano:              row.ano,
        valor:            row.valor,
        unidade:          row.unidade,
        fonte_tipo:       'manual',
      });
    }
    res.json({ imported: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { run, getStatus, getRuns, uploadManual };
