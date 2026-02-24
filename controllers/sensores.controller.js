const pool = require("../util/db");

exports.getAll = async (req, res) => {
  try {
    const { municipio } = req.query;
    let query = `
      SELECT s.*,
        CASE WHEN s.ultimo_valor > s.threshold THEN true ELSE false END AS em_alerta
      FROM sensores s
      WHERE 1=1
    `;
    const params = [];

    if (municipio) {
      params.push(municipio);
      query += ` AND s.fk_municipio = $${params.length}`;
    }

    query += " ORDER BY s.id ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAlertas = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM sensores WHERE ultimo_valor > threshold ORDER BY ultimo_valor DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateLeitura = async (req, res) => {
  try {
    const { id } = req.params;
    const { ultimo_valor } = req.body;

    const result = await pool.query(
      `UPDATE sensores SET ultimo_valor = $1, ultima_leitura = NOW()
       WHERE id = $2
       RETURNING *`,
      [ultimo_valor, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Sensor not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
