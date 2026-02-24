const pool = require("../util/db");

exports.getByIndicador = async (req, res) => {
  try {
    const { indicador_id } = req.query;
    if (!indicador_id) {
      return res.status(400).json({ error: "indicador_id query param is required" });
    }

    const result = await pool.query(
      "SELECT * FROM execucao WHERE fk_indicador = $1 ORDER BY data_registo DESC",
      [indicador_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { fk_indicador, valor, descricao, data_registo, meta_alvo_proposta } = req.body;

    // Partners can only submit for their assigned measures
    if (req.appRole === "parceiro_externo") {
      const indicador = await pool.query(
        "SELECT fk_medida FROM indicadores WHERE id = $1",
        [fk_indicador]
      );
      if (indicador.rows.length === 0) {
        return res.status(404).json({ error: "Indicador not found" });
      }
      const medidaId = indicador.rows[0].fk_medida;
      if (!req.appMedidasAtribuidas.includes(medidaId)) {
        return res.status(403).json({ error: "You are not assigned to this measure" });
      }
    }

    // Partners get estado='Pendente', others get 'Aprovado'
    const estado = req.appRole === "parceiro_externo" ? "Pendente" : "Aprovado";

    const result = await pool.query(
      `INSERT INTO execucao (fk_indicador, valor, descricao, data_registo, estado)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [fk_indicador, valor, descricao, data_registo, estado]
    );

    // Scenario C: if meta_alvo_proposta is provided, update the indicador
    if (meta_alvo_proposta !== undefined && meta_alvo_proposta !== null) {
      await pool.query(
        "UPDATE indicadores SET meta_alvo = $1, is_validada = FALSE WHERE id = $2",
        [meta_alvo_proposta, fk_indicador]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
