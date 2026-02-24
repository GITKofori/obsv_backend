const pool = require("../util/db");

exports.getPendentes = async (req, res) => {
  try {
    const execucoesPendentes = await pool.query(
      "SELECT * FROM execucao WHERE estado = 'Pendente' ORDER BY data_registo DESC"
    );

    const indicadoresNaoValidados = await pool.query(
      "SELECT * FROM indicadores WHERE is_validada = FALSE AND meta_alvo IS NOT NULL ORDER BY id ASC"
    );

    res.json({
      execucoes: execucoesPendentes.rows,
      indicadores: indicadoresNaoValidados.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.aprovar = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo } = req.query;

    if (tipo === "execucao") {
      const result = await pool.query(
        "UPDATE execucao SET estado = 'Aprovado' WHERE id = $1 RETURNING *",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Execucao not found" });
      }
      return res.json(result.rows[0]);
    }

    if (tipo === "indicador") {
      const result = await pool.query(
        "UPDATE indicadores SET is_validada = TRUE WHERE id = $1 RETURNING *",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Indicador not found" });
      }
      return res.json(result.rows[0]);
    }

    return res.status(400).json({ error: "tipo query param must be 'execucao' or 'indicador'" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.rejeitar = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo } = req.query;

    if (tipo === "execucao") {
      const result = await pool.query(
        "UPDATE execucao SET estado = 'Rejeitado' WHERE id = $1 RETURNING *",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Execucao not found" });
      }
      return res.json(result.rows[0]);
    }

    if (tipo === "indicador") {
      const result = await pool.query(
        "UPDATE indicadores SET meta_alvo = NULL, is_validada = FALSE WHERE id = $1 RETURNING *",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Indicador not found" });
      }
      return res.json(result.rows[0]);
    }

    return res.status(400).json({ error: "tipo query param must be 'execucao' or 'indicador'" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
