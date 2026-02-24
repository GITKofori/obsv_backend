const pool = require("../util/db");

exports.getByMedida = async (req, res) => {
  try {
    const { medida_id } = req.query;
    if (!medida_id) {
      return res.status(400).json({ error: "medida_id query param is required" });
    }

    const result = await pool.query(
      `SELECT i.*,
        COALESCE(
          (SELECT SUM(e.valor) FROM execucao e WHERE e.fk_indicador = i.id AND e.estado = 'Aprovado'),
          0
        ) AS valor_acumulado
      FROM indicadores i
      WHERE i.fk_medida = $1
      ORDER BY i.id ASC`,
      [medida_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { nome, unidade, tipo_meta, meta_alvo, fk_medida } = req.body;

    // Auto-validate if created by cimat_admin
    const isValidada = req.appRole === "cimat_admin";

    const result = await pool.query(
      `INSERT INTO indicadores (nome, unidade, tipo_meta, meta_alvo, fk_medida, is_validada)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nome, unidade, tipo_meta, meta_alvo ?? null, fk_medida, isValidada]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, unidade, meta_alvo, is_validada } = req.body;

    // Only cimat_admin can set is_validada
    const fields = ["nome = $1", "unidade = $2", "meta_alvo = $3"];
    const params = [nome, unidade, meta_alvo];

    if (req.appRole === "cimat_admin" && is_validada !== undefined) {
      params.push(is_validada);
      fields.push(`is_validada = $${params.length}`);
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE indicadores SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Indicador not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM indicadores WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Indicador not found" });
    }
    res.json({ message: "Indicador deleted", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
