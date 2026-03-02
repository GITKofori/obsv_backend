const pool = require("../util/db");
const alertService = require("../services/alert.service");

// ─── CRUD: Alert Rules ────────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM alertas_regras WHERE fk_user = $1 ORDER BY criado_em DESC",
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const {
      nome,
      parcela,
      topico,
      campo,
      operador,
      valor_threshold,
      tipo,
      funcao_agregacao,
      intervalo_minutos,
    } = req.body;

    // Validate aggregated rules have required fields
    if (tipo === "aggregated" && (!funcao_agregacao || !intervalo_minutos)) {
      return res.status(400).json({
        error: "Regras agregadas requerem funcao_agregacao e intervalo_minutos",
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO alertas_regras
         (fk_user, nome, parcela, topico, campo, operador, valor_threshold,
          tipo, funcao_agregacao, intervalo_minutos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.userId,
        nome,
        parcela,
        topico,
        campo,
        operador,
        valor_threshold,
        tipo,
        funcao_agregacao || null,
        intervalo_minutos || null,
      ]
    );

    alertService.invalidateCache();
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome,
      parcela,
      topico,
      campo,
      operador,
      valor_threshold,
      tipo,
      funcao_agregacao,
      intervalo_minutos,
      ativo,
    } = req.body;

    // Verify ownership
    const existing = await pool.query(
      "SELECT id FROM alertas_regras WHERE id = $1 AND fk_user = $2",
      [id, req.userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Regra não encontrada" });
    }

    const { rows } = await pool.query(
      `UPDATE alertas_regras
       SET nome=$1, parcela=$2, topico=$3, campo=$4, operador=$5,
           valor_threshold=$6, tipo=$7, funcao_agregacao=$8,
           intervalo_minutos=$9, ativo=$10
       WHERE id=$11 AND fk_user=$12
       RETURNING *`,
      [
        nome,
        parcela,
        topico,
        campo,
        operador,
        valor_threshold,
        tipo,
        funcao_agregacao || null,
        intervalo_minutos || null,
        ativo !== undefined ? ativo : true,
        id,
        req.userId,
      ]
    );

    alertService.invalidateCache();
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "DELETE FROM alertas_regras WHERE id = $1 AND fk_user = $2 RETURNING id",
      [id, req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Regra não encontrada" });
    }
    alertService.invalidateCache();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.toggleAtivo = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE alertas_regras SET ativo = NOT ativo
       WHERE id = $1 AND fk_user = $2
       RETURNING *`,
      [id, req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Regra não encontrada" });
    }
    alertService.invalidateCache();
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Alert trigger history ────────────────────────────────────────────────────

exports.getDisparados = async (req, res) => {
  try {
    const { limit = 50, reconhecido } = req.query;
    const params = [req.userId];
    let where = "WHERE r.fk_user = $1";

    if (reconhecido !== undefined) {
      params.push(reconhecido === "true");
      where += ` AND d.reconhecido = $${params.length}`;
    }

    params.push(parseInt(limit, 10));
    const { rows } = await pool.query(
      `SELECT d.*, r.nome AS regra_nome, r.operador, r.valor_threshold
       FROM alertas_disparados d
       JOIN alertas_regras r ON r.id = d.fk_regra
       ${where}
       ORDER BY d.disparado_em DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reconhecer = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE alertas_disparados d
       SET reconhecido = true, reconhecido_em = NOW(), reconhecido_por = $1
       FROM alertas_regras r
       WHERE d.id = $2
         AND d.fk_regra = r.id
         AND r.fk_user = $1
       RETURNING d.*`,
      [req.userId, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Alerta não encontrado" });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reconhecerTodos = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE alertas_disparados d
       SET reconhecido = true, reconhecido_em = NOW(), reconhecido_por = $1
       FROM alertas_regras r
       WHERE d.fk_regra = r.id
         AND r.fk_user = $1
         AND d.reconhecido = false
       RETURNING d.id`,
      [req.userId]
    );
    res.json({ acknowledged: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
