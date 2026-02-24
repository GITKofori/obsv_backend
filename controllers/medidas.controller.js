const pool = require("../util/db");

exports.getAll = async (req, res) => {
  try {
    const { municipio, setor } = req.query;
    let query = `
      SELECT m.*,
        COALESCE(
          ARRAY(SELECT mo.fk_ods FROM medidas_ods mo WHERE mo.fk_medida = m.id ORDER BY mo.fk_ods),
          '{}'::integer[]
        ) AS ods_associados,
        (SELECT COUNT(*) FROM indicadores i WHERE i.fk_medida = m.id) AS num_indicadores
      FROM medidas m
      WHERE 1=1
    `;
    const params = [];

    if (municipio) {
      params.push(municipio);
      query += ` AND m.fk_municipio = $${params.length}`;
    }
    if (setor) {
      params.push(setor);
      query += ` AND m.setor = $${params.length}`;
    }

    query += " ORDER BY m.id ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const medidaResult = await pool.query(
      `SELECT m.*,
        COALESCE(
          ARRAY(SELECT mo.fk_ods FROM medidas_ods mo WHERE mo.fk_medida = m.id ORDER BY mo.fk_ods),
          '{}'::integer[]
        ) AS ods_associados
       FROM medidas m WHERE m.id = $1`,
      [id]
    );
    if (medidaResult.rows.length === 0) {
      return res.status(404).json({ error: "Medida not found" });
    }

    const indicadoresResult = await pool.query(
      `SELECT i.*,
        COALESCE(
          (SELECT json_agg(e.*) FROM execucao e WHERE e.fk_indicador = i.id AND e.estado = 'Aprovado'),
          '[]'::json
        ) AS execucoes
      FROM indicadores i
      WHERE i.fk_medida = $1
      ORDER BY i.id ASC`,
      [id]
    );

    const medida = medidaResult.rows[0];
    medida.indicadores = indicadoresResult.rows;

    res.json(medida);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { id, designacao, descricao, objetivos, setor, tipo_resposta, fk_municipio, ods_associados } = req.body;

    // Technicians can only create medidas for their own municipality
    if (req.appRole === "tecnico_municipal" && fk_municipio !== req.appMunicipio) {
      return res.status(403).json({ error: "Technicians can only create medidas for their own municipality" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO medidas (id, designacao, descricao, objetivos, setor, tipo_resposta, fk_municipio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, designacao, descricao, objetivos, setor, tipo_resposta, fk_municipio]
      );

      const medida = result.rows[0];

      if (Array.isArray(ods_associados) && ods_associados.length > 0) {
        const odsValues = ods_associados.map((odsId) => `('${medida.id}', ${odsId})`).join(", ");
        await client.query(`INSERT INTO medidas_ods (fk_medida, fk_ods) VALUES ${odsValues}`);
      }

      await client.query("COMMIT");
      medida.ods_associados = ods_associados || [];
      res.status(201).json(medida);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { designacao, descricao, objetivos, setor, tipo_resposta, fk_municipio, ods_associados } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE medidas
         SET designacao = $1, descricao = $2, objetivos = $3, setor = $4, tipo_resposta = $5, fk_municipio = $6
         WHERE id = $7
         RETURNING *`,
        [designacao, descricao, objetivos, setor, tipo_resposta, fk_municipio, id]
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Medida not found" });
      }

      if (Array.isArray(ods_associados)) {
        await client.query("DELETE FROM medidas_ods WHERE fk_medida = $1", [id]);
        if (ods_associados.length > 0) {
          const odsValues = ods_associados.map((odsId) => `('${id}', ${odsId})`).join(", ");
          await client.query(`INSERT INTO medidas_ods (fk_medida, fk_ods) VALUES ${odsValues}`);
        }
      }

      await client.query("COMMIT");
      const medida = result.rows[0];
      medida.ods_associados = ods_associados || [];
      res.json(medida);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM medidas WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Medida not found" });
    }
    res.json({ message: "Medida deleted", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
