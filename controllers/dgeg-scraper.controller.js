// backend/controllers/dgeg-scraper.controller.js
'use strict';

const { fork } = require('child_process');
const path = require('path');
const pool = require('../util/db');

const SCRAPER_PATH = path.join(__dirname, '../../scraper/dgeg-energy/index.js');

async function run(req, res) {
  const { year_from, year_to, types, force } = req.body;

  const from = parseInt(year_from, 10);
  const to   = parseInt(year_to,   10);

  if (!from || !to || isNaN(from) || isNaN(to)) {
    return res.status(400).json({ error: 'year_from and year_to required (integers)' });
  }
  if (from < 2008 || to > 2024 || from > to) {
    return res.status(400).json({ error: 'year_from must be ≥ 2008, year_to ≤ 2024, from ≤ to' });
  }

  const typeList = Array.isArray(types) && types.length ? types : ['gas', 'oil', 'electricity'];
  const validTypes = typeList.filter(t => ['gas', 'oil', 'electricity'].includes(t));
  if (!validTypes.length) return res.status(400).json({ error: 'types must include gas, oil, and/or electricity' });

  const args = [
    '--from', String(from),
    '--to',   String(to),
    '--types', validTypes.join(','),
  ];
  if (force) args.push('--force');

  const child = fork(SCRAPER_PATH, args, { env: { ...process.env } });

  try {
    const runId = await new Promise((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => reject(new Error('DGEG scraper did not start within 10s')), 10_000);
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
    return res.json({ runId, message: `DGEG scraper started (${from}–${to}, ${validTypes.join(',')})` });
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
      `SELECT id, ano, status, source, started_at, finished_at, stats
       FROM scraper_runs WHERE id = $1`,
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
      `SELECT id, ano, status, source, started_at, finished_at, stats
       FROM scraper_runs WHERE source = 'dgeg'
       ORDER BY started_at DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { run, getStatus, getRuns };
