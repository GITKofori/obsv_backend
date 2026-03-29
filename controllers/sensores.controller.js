const pool = require("../util/db");
const mqttService = require("../services/mqtt.service");

const IOT_MIN_DATE = '2026-03-16T00:00:00Z';

// ─── SSE stream ───────────────────────────────────────────────────────────────
// Accepts JWT via query param (?token=...) because EventSource doesn't support
// custom request headers.
exports.streamSSE = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Allow browser EventSource (CORS)
  res.setHeader("X-Accel-Buffering", "no");

  // Send current in-memory state as first event
  const state = mqttService.getLatestState();
  res.write(`event: init\ndata: ${JSON.stringify(state)}\n\n`);

  mqttService.addSSEClient(res);

  req.on("close", () => {
    mqttService.removeSSEClient(res);
  });
};

// ─── Latest in-memory state ───────────────────────────────────────────────────
exports.getLatest = (req, res) => {
  res.json(mqttService.getLatestState());
};

// ─── Historical readings ──────────────────────────────────────────────────────
exports.getHistorico = async (req, res) => {
  try {
    const { parcela, topico = "t2", limit = 48, from, to } = req.query;
    const table = topico === "t1" ? "leituras_t1" : "leituras_t2";
    const params = [];
    let where = "WHERE 1=1";
    params.push(IOT_MIN_DATE);
    where += ` AND timestamp >= $${params.length}`;

    if (parcela) {
      params.push(parcela);
      where += ` AND parcela = $${params.length}`;
    }
    if (from) {
      params.push(from);
      where += ` AND timestamp >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND timestamp <= $${params.length}`;
    }

    params.push(parseInt(limit, 10));
    const query = `
      SELECT parcela, timestamp, dados
      FROM ${table}
      ${where}
      ORDER BY timestamp DESC
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(query, params);
    // Return in ascending order for charts
    res.json(rows.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Stats (aggregate over period) ───────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const { parcela, campo, topico = "t2", periodo = "7d", granularidade = "day" } = req.query;

    if (!parcela || !campo) {
      return res.status(400).json({ error: "parcela and campo are required" });
    }

    const table = topico === "t1" ? "leituras_t1" : "leituras_t2";

    // Convert period string to interval
    const intervalMap = { "1d": "1 day", "7d": "7 days", "30d": "30 days", "90d": "90 days" };
    const interval = intervalMap[periodo] || "7 days";

    // Granularity bucketing
    const truncMap = { hour: "hour", day: "day", week: "week", month: "month" };
    const trunc = truncMap[granularidade] || "day";

    const { rows } = await pool.query(
      `SELECT
         date_trunc($1, timestamp)                          AS periodo,
         AVG((dados->>'${campo}')::decimal)                 AS media,
         MIN((dados->>'${campo}')::decimal)                 AS minimo,
         MAX((dados->>'${campo}')::decimal)                 AS maximo,
         COUNT(*)::integer                                  AS contagem
       FROM ${table}
       WHERE parcela = $2
         AND timestamp >= NOW() - $3::interval
         AND timestamp >= $5::timestamp
         AND dados ? $4
       GROUP BY 1
       ORDER BY 1 ASC`,
      [trunc, parcela, interval, campo, IOT_MIN_DATE]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Legacy endpoints (kept for backwards compat) ────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const { municipio } = req.query;
    let query = `
      SELECT s.*,
        CASE WHEN s.ultimo_valor > s.limiar_alerta THEN true ELSE false END AS em_alerta
      FROM sensores_iot s
      WHERE 1=1
    `;
    const params = [];

    if (municipio) {
      params.push(municipio);
      query += ` AND s.fk_municipio = $${params.length}`;
    }

    query += " ORDER BY s.id ASC";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAlertas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM sensores_iot WHERE ultimo_valor > limiar_alerta ORDER BY ultimo_valor DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateLeitura = async (req, res) => {
  try {
    const { id } = req.params;
    const { ultimo_valor } = req.body;
    const { rows } = await pool.query(
      `UPDATE sensores_iot SET ultimo_valor = $1, ultima_leitura = NOW()
       WHERE id = $2 RETURNING *`,
      [ultimo_valor, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Sensor not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
