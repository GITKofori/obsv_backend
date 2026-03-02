const pool = require("../util/db");

exports.getPendentes = async (req, res) => {
  try {
    const execucoesPendentes = await pool.query(`
      SELECT
        e.*,
        i.nome              AS indicador_nome,
        i.tipo_meta,
        i.meta_alvo,
        i.is_validada,
        m.id                AS medida_id,
        m.designacao        AS medida_designacao,
        m.setor,
        mun.nome            AS municipio_nome
      FROM execucao e
      JOIN indicadores i   ON i.id = e.fk_indicador
      JOIN medidas m        ON m.id = i.fk_medida
      JOIN municipios mun   ON mun.id = m.fk_municipio
      WHERE e.estado_validacao = 'Pendente'
      ORDER BY e.data_insercao DESC
    `);

    const metasPendentes = await pool.query(`
      SELECT
        i.*,
        m.id          AS medida_id,
        m.designacao  AS medida_designacao,
        mun.nome      AS municipio_nome
      FROM indicadores i
      JOIN medidas m      ON m.id = i.fk_medida
      JOIN municipios mun ON mun.id = m.fk_municipio
      WHERE i.is_validada = FALSE
        AND i.meta_alvo IS NOT NULL
      ORDER BY i.id ASC
    `);

    res.json({
      execucoes_pendentes: execucoesPendentes.rows,
      metas_pendentes: metasPendentes.rows,
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
        "UPDATE execucao SET estado_validacao = 'Aprovado' WHERE id = $1 RETURNING *",
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
        "UPDATE execucao SET estado_validacao = 'Rejeitado' WHERE id = $1 RETURNING *",
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
