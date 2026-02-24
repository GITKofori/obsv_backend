const pool = require("../util/db");
const { getUserRole } = require("../middleware/rbac");

exports.trajetoria = async (req, res) => {
  try {
    const { municipio } = req.query;
    const params = [];
    let municipioFilter = "";

    if (municipio) {
      params.push(municipio);
      municipioFilter = ` WHERE m.fk_municipio = $${params.length}`;
    }

    // Baseline data from municipios
    const baselineQuery = municipio
      ? "SELECT * FROM municipios WHERE id = $1"
      : "SELECT * FROM municipios ORDER BY nome ASC";
    const baselineParams = municipio ? [municipio] : [];
    const baselineResult = await pool.query(baselineQuery, baselineParams);

    // Medidas progress summary
    const progressQuery = `
      SELECT
        COUNT(*) AS total_medidas,
        COUNT(CASE WHEN (
          SELECT COUNT(*) FROM indicadores i
          WHERE i.fk_medida = m.id AND i.is_validada = TRUE
        ) > 0 THEN 1 END) AS medidas_com_indicadores_validados
      FROM medidas m${municipioFilter}
    `;
    const progressResult = await pool.query(progressQuery, params);

    // Medidas por setor
    const setorQuery = `
      SELECT m.setor, COUNT(*) AS total_medidas
      FROM medidas m${municipioFilter}
      GROUP BY m.setor
      ORDER BY total_medidas DESC
    `;
    const setorResult = await pool.query(setorQuery, params);

    res.json({
      baseline: baselineResult.rows,
      progress: progressResult.rows[0],
      medidasPorSetor: setorResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.pmacSummary = async (req, res) => {
  try {
    const { municipio } = req.query;
    const params = [];
    let municipioFilter = "";

    if (municipio) {
      params.push(municipio);
      municipioFilter = ` WHERE m.fk_municipio = $${params.length}`;
    }

    // Medidas with nested indicadores and aggregated ODS ids
    const medidasQuery = `
      SELECT m.*,
        COALESCE(
          ARRAY(SELECT mo.fk_ods FROM medidas_ods mo WHERE mo.fk_medida = m.id ORDER BY mo.fk_ods),
          '{}'::integer[]
        ) AS ods_associados,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', i.id,
            'nome', i.nome,
            'unidade', i.unidade,
            'meta_alvo', i.meta_alvo,
            'is_validada', i.is_validada,
            'valor_acumulado', COALESCE((SELECT SUM(e.valor_executado) FROM execucao e WHERE e.fk_indicador = i.id AND e.estado_validacao = 'Aprovado'), 0),
            'ultimo_registo', (SELECT MAX(e.data_insercao) FROM execucao e WHERE e.fk_indicador = i.id AND e.estado_validacao = 'Aprovado')
          ) ORDER BY i.id) FROM indicadores i WHERE i.fk_medida = m.id),
          '[]'::json
        ) AS indicadores
      FROM medidas m${municipioFilter}
      ORDER BY m.id ASC
    `;
    const medidasResult = await pool.query(medidasQuery, params);

    // ODS summary via junction table
    const odsQuery = municipio
      ? `
        SELECT mo.fk_ods AS ods_id, COUNT(DISTINCT mo.fk_medida) AS count
        FROM medidas_ods mo
        JOIN medidas m ON m.id = mo.fk_medida
        WHERE m.fk_municipio = $1
        GROUP BY mo.fk_ods
        ORDER BY mo.fk_ods ASC
      `
      : `
        SELECT mo.fk_ods AS ods_id, COUNT(DISTINCT mo.fk_medida) AS count
        FROM medidas_ods mo
        GROUP BY mo.fk_ods
        ORDER BY mo.fk_ods ASC
      `;
    const odsResult = await pool.query(odsQuery, params);

    // Setor progress
    const setorQuery = `
      SELECT m.setor, COUNT(*) AS total_medidas
      FROM medidas m${municipioFilter}
      GROUP BY m.setor
      ORDER BY total_medidas DESC
    `;
    const setorResult = await pool.query(setorQuery, params);

    res.json({
      medidas: medidasResult.rows,
      ods_summary: odsResult.rows,
      setor_progress: setorResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.userRole = async (req, res) => {
  try {
    const userRole = await getUserRole(req.userId);
    if (!userRole) {
      return res.status(404).json({ error: "No role found for this user" });
    }
    res.json(userRole);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
