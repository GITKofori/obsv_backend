// backend/controllers/gestao-validation.controller.js
'use strict';
const pool = require('../util/db');

/**
 * GET /pending
 * Returns submitted (awaiting validation) execucao records.
 * Query params: municipio (id), setor
 */
async function getPending(req, res) {
  try {
    const { municipio, setor } = req.query;
    const conditions = ["e.estado_validacao = 'Submetido'"];
    const params = [];

    if (municipio) {
      params.push(parseInt(municipio, 10));
      conditions.push(`m.fk_municipio = $${params.length}`);
    }
    if (setor) {
      params.push(setor);
      conditions.push(`m.setor = $${params.length}`);
    }

    // Tecnico can only see pending items from their municipality
    if (req.appRole === 'tecnico_municipal') {
      params.push(req.appMunicipio);
      conditions.push(`m.fk_municipio = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.fk_indicador, e.ano_referencia,
              e.valor_executado, e.url_evidencia, e.observacoes, e.data_insercao, e.estado_validacao,
              i.nome AS indicador_nome, i.unidade,
              m.id AS medida_id, m.designacao AS medida_designacao, m.setor, m.tipo_resposta,
              mu.nome AS municipio_nome, mu.id AS municipio_id
       FROM execucao e
       JOIN indicadores i ON i.id = e.fk_indicador
       JOIN medidas m ON m.id = i.fk_medida
       JOIN municipios mu ON mu.id = m.fk_municipio
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.data_insercao DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /:id/submit
 * Municipal technician submits a draft for validation.
 * Only allowed when estado_validacao = 'Rascunho' or 'Rejeitado'.
 */
async function submit(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `UPDATE execucao SET estado_validacao = 'Submetido', nota_rejeicao = NULL
       WHERE id = $1 AND estado_validacao IN ('Rascunho', 'Rejeitado')
       RETURNING id, estado_validacao`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found or not in submittable state' });

    await pool.query(
      `INSERT INTO validation_log (fk_execucao, action, actor_id, actor_email)
       VALUES ($1, 'submitted', $2, $3)`,
      [id, req.userId, req.userEmail]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /:id/validate
 * Admin/regional validates a submitted record.
 */
async function validateRecord(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    // Scope check for tecnico
    if (req.appRole === 'tecnico_municipal') {
      const check = await pool.query(
        `SELECT m.fk_municipio FROM execucao e
         JOIN indicadores i ON i.id = e.fk_indicador
         JOIN medidas m ON m.id = i.fk_medida
         WHERE e.id = $1`, [id]
      );
      if (!check.rows.length || check.rows[0].fk_municipio !== req.appMunicipio) {
        return res.status(403).json({ error: 'Access denied: not your municipality' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE execucao SET estado_validacao = 'Aprovado'
       WHERE id = $1 AND estado_validacao = 'Submetido'
       RETURNING id, estado_validacao`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found or not in submitted state' });

    await pool.query(
      `INSERT INTO validation_log (fk_execucao, action, actor_id, actor_email, note)
       VALUES ($1, 'validated', $2, $3, $4)`,
      [id, req.userId, req.userEmail, req.body.note ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /:id/reject
 * Admin/regional rejects with a note.
 */
async function reject(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Rejection note is required' });
  try {
    // Scope check for tecnico
    if (req.appRole === 'tecnico_municipal') {
      const check = await pool.query(
        `SELECT m.fk_municipio FROM execucao e
         JOIN indicadores i ON i.id = e.fk_indicador
         JOIN medidas m ON m.id = i.fk_medida
         WHERE e.id = $1`, [id]
      );
      if (!check.rows.length || check.rows[0].fk_municipio !== req.appMunicipio) {
        return res.status(403).json({ error: 'Access denied: not your municipality' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE execucao SET estado_validacao = 'Rejeitado', nota_rejeicao = $2
       WHERE id = $1 AND estado_validacao = 'Submetido'
       RETURNING id, estado_validacao, nota_rejeicao`,
      [id, note.trim()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found or not in submitted state' });

    await pool.query(
      `INSERT INTO validation_log (fk_execucao, action, actor_id, actor_email, note)
       VALUES ($1, 'rejected', $2, $3, $4)`,
      [id, req.userId, req.userEmail, note.trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /pending-count
 * Returns the count of submitted records (for sidebar badge).
 * Scoped to municipality for tecnico_municipal.
 */
async function getPendingCount(req, res) {
  try {
    let query = "SELECT COUNT(*) AS cnt FROM execucao e WHERE e.estado_validacao = 'Submetido'";
    const params = [];

    if (req.appRole === 'tecnico_municipal') {
      query = `SELECT COUNT(*) AS cnt FROM execucao e
               JOIN indicadores i ON i.id = e.fk_indicador
               JOIN medidas m ON m.id = i.fk_medida
               WHERE e.estado_validacao = 'Submetido' AND m.fk_municipio = $1`;
      params.push(req.appMunicipio);
    }

    const { rows } = await pool.query(query, params);
    res.json({ count: Number(rows[0].cnt) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getPending, submit, validateRecord, reject, getPendingCount };
