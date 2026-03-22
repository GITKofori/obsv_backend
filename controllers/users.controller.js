'use strict';
const pool = require('../util/db');
const supabaseAdmin = require('../util/supabase-admin');
const { enforceMunicipalScope } = require('../middleware/rbac');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAudit(actorId, actorEmail, action, targetId, details = {}) {
  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'user', $4, $5)`,
    [actorId, actorEmail, action, String(targetId), JSON.stringify(details)]
  );
}

function canInviteRole(callerRole, targetRole) {
  if (callerRole === 'cimat_admin') return true;
  if (callerRole === 'tecnico_municipal') {
    return targetRole === 'tecnico_municipal' || targetRole === 'parceiro_externo';
  }
  return false;
}

// ─── GET /me ─────────────────────────────────────────────────────────────────

async function getMe(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ur.id, ur.supabase_user_id, ur.role, ur.fk_municipio,
              m.nome AS municipio_nome, ur.medidas_atribuidas,
              ur.nome, ur.email, ur.estado
       FROM user_roles ur
       LEFT JOIN municipios m ON m.id = ur.fk_municipio
       WHERE ur.supabase_user_id = $1`,
      [req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User role not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET / ───────────────────────────────────────────────────────────────────

async function listUsers(req, res) {
  try {
    const { role, municipio, estado, search, page = 1, limit = 20 } = req.query;
    const conditions = [];
    const params = [];

    if (req.appRole === 'tecnico_municipal') {
      params.push(req.appMunicipio);
      conditions.push(`ur.fk_municipio = $${params.length}`);
    } else if (municipio) {
      params.push(parseInt(municipio, 10));
      conditions.push(`ur.fk_municipio = $${params.length}`);
    }

    if (role) {
      params.push(role);
      conditions.push(`ur.role = $${params.length}`);
    }
    if (estado) {
      params.push(estado);
      conditions.push(`ur.estado = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(ur.nome ILIKE $${params.length} OR ur.email ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM user_roles ur ${where}`, params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    params.push(offset);
    const { rows } = await pool.query(
      `SELECT ur.id, ur.supabase_user_id, ur.role, ur.fk_municipio,
              m.nome AS municipio_nome, ur.medidas_atribuidas,
              ur.nome, ur.email, ur.estado, ur.created_at, ur.updated_at
       FROM user_roles ur
       LEFT JOIN municipios m ON m.id = ur.fk_municipio
       ${where}
       ORDER BY ur.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /:id ────────────────────────────────────────────────────────────────

async function getUserById(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ur.id, ur.supabase_user_id, ur.role, ur.fk_municipio,
              m.nome AS municipio_nome, ur.medidas_atribuidas,
              ur.nome, ur.email, ur.estado, ur.invited_by, ur.created_at, ur.updated_at
       FROM user_roles ur
       LEFT JOIN municipios m ON m.id = ur.fk_municipio
       WHERE ur.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const user = rows[0];
    if (!enforceMunicipalScope(req, res, user.fk_municipio)) return;

    const activity = await pool.query(
      `SELECT id, action, actor_email, details, created_at
       FROM audit_log WHERE target_type = 'user' AND target_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [String(id)]
    );

    res.json({ ...user, recent_activity: activity.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /invite ────────────────────────────────────────────────────────────

async function inviteUser(req, res) {
  const { email, nome, role, fk_municipio, medidas_atribuidas = [] } = req.body;

  if (!email || !nome || !role) {
    return res.status(400).json({ error: 'email, nome, and role are required' });
  }
  if (!['cimat_admin', 'tecnico_municipal', 'parceiro_externo'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (role !== 'cimat_admin' && !fk_municipio) {
    return res.status(400).json({ error: 'fk_municipio is required for this role' });
  }

  if (!canInviteRole(req.appRole, role)) {
    return res.status(403).json({ error: 'You cannot invite users with this role' });
  }
  if (req.appRole === 'tecnico_municipal' && fk_municipio !== req.appMunicipio) {
    return res.status(403).json({ error: 'You can only invite users for your municipality' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM user_roles WHERE email = $1', [email]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const { data: supabaseUser, error: supabaseError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { nome: nome || '' }
    });
    if (supabaseError) {
      return res.status(500).json({ error: `Supabase error: ${supabaseError.message}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO user_roles (supabase_user_id, role, fk_municipio, medidas_atribuidas, nome, email, estado, invited_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'convidado', $7)
       RETURNING id, supabase_user_id, role, fk_municipio, medidas_atribuidas, nome, email, estado, created_at`,
      [supabaseUser.user.id, role, fk_municipio || null, medidas_atribuidas, nome || null, email, req.userId]
    );

    await logAudit(req.userId, req.userEmail, 'user.invited', rows[0].id, { role, fk_municipio, email });

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── PUT /:id ────────────────────────────────────────────────────────────────

async function updateUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const { rows: current } = await pool.query(
      'SELECT * FROM user_roles WHERE id = $1', [id]
    );
    if (!current.length) return res.status(404).json({ error: 'User not found' });

    const user = current[0];
    if (!enforceMunicipalScope(req, res, user.fk_municipio)) return;

    if (req.appRole === 'tecnico_municipal' && req.body.role === 'cimat_admin') {
      return res.status(403).json({ error: 'Cannot promote to cimat_admin' });
    }

    const { nome, role, fk_municipio, medidas_atribuidas } = req.body;
    const changes = {};

    if (nome !== undefined && nome !== user.nome) changes.nome = [user.nome, nome];
    if (role !== undefined && role !== user.role) changes.role = [user.role, role];
    if (fk_municipio !== undefined && fk_municipio !== user.fk_municipio) changes.fk_municipio = [user.fk_municipio, fk_municipio];
    if (medidas_atribuidas !== undefined) changes.medidas_atribuidas = [user.medidas_atribuidas, medidas_atribuidas];

    const setClauses = ['updated_at = NOW()'];
    const updateParams = [];
    if (nome !== undefined) { updateParams.push(nome); setClauses.push(`nome = $${updateParams.length}`); }
    if (role !== undefined) { updateParams.push(role); setClauses.push(`role = $${updateParams.length}`); }
    if (fk_municipio !== undefined) { updateParams.push(fk_municipio); setClauses.push(`fk_municipio = $${updateParams.length}`); }
    if (medidas_atribuidas !== undefined) { updateParams.push(medidas_atribuidas); setClauses.push(`medidas_atribuidas = $${updateParams.length}`); }

    updateParams.push(id);
    const { rows } = await pool.query(
      `UPDATE user_roles SET ${setClauses.join(', ')}
       WHERE id = $${updateParams.length}
       RETURNING id, supabase_user_id, role, fk_municipio, medidas_atribuidas, nome, email, estado`,
      updateParams
    );

    if (Object.keys(changes).length) {
      await logAudit(req.userId, req.userEmail, 'user.edited', id, { changes });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── PUT /:id/deactivate ────────────────────────────────────────────────────

async function deactivateUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const { rows: current } = await pool.query(
      'SELECT supabase_user_id, fk_municipio, estado FROM user_roles WHERE id = $1', [id]
    );
    if (!current.length) return res.status(404).json({ error: 'User not found' });
    if (!enforceMunicipalScope(req, res, current[0].fk_municipio)) return;
    if (current[0].estado === 'desativado') {
      return res.status(400).json({ error: 'User is already deactivated' });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(current[0].supabase_user_id, {
      ban_duration: '876000h'
    });
    if (error) return res.status(500).json({ error: `Supabase error: ${error.message}` });

    await pool.query(
      "UPDATE user_roles SET estado = 'desativado', updated_at = NOW() WHERE id = $1", [id]
    );

    await logAudit(req.userId, req.userEmail, 'user.deactivated', id, { reason: req.body.reason || '' });

    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── PUT /:id/reactivate ────────────────────────────────────────────────────

async function reactivateUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const { rows: current } = await pool.query(
      'SELECT supabase_user_id, fk_municipio, estado FROM user_roles WHERE id = $1', [id]
    );
    if (!current.length) return res.status(404).json({ error: 'User not found' });
    if (!enforceMunicipalScope(req, res, current[0].fk_municipio)) return;
    if (current[0].estado !== 'desativado') {
      return res.status(400).json({ error: 'User is not deactivated' });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(current[0].supabase_user_id, {
      ban_duration: 'none'
    });
    if (error) return res.status(500).json({ error: `Supabase error: ${error.message}` });

    await pool.query(
      "UPDATE user_roles SET estado = 'ativo', updated_at = NOW() WHERE id = $1", [id]
    );

    await logAudit(req.userId, req.userEmail, 'user.reactivated', id, {});

    res.json({ message: 'User reactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /:id/resend-invite ────────────────────────────────────────────────

async function resendInvite(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const { rows: current } = await pool.query(
      'SELECT supabase_user_id, fk_municipio, estado, email FROM user_roles WHERE id = $1', [id]
    );
    if (!current.length) return res.status(404).json({ error: 'User not found' });
    if (!enforceMunicipalScope(req, res, current[0].fk_municipio)) return;
    if (current[0].estado !== 'convidado') {
      return res.status(400).json({ error: 'User has already accepted the invite' });
    }

    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: current[0].email
    });
    if (error) return res.status(500).json({ error: `Supabase error: ${error.message}` });

    await logAudit(req.userId, req.userEmail, 'user.invite_resent', id, {});

    res.json({ message: 'Invite resent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /:id/reset-password ───────────────────────────────────────────────

async function resetPassword(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const { rows: current } = await pool.query(
      'SELECT supabase_user_id, fk_municipio, estado, email FROM user_roles WHERE id = $1', [id]
    );
    if (!current.length) return res.status(404).json({ error: 'User not found' });
    if (!enforceMunicipalScope(req, res, current[0].fk_municipio)) return;
    if (current[0].estado !== 'ativo') {
      return res.status(400).json({ error: 'Password reset only available for active users' });
    }

    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: current[0].email
    });
    if (error) return res.status(500).json({ error: `Supabase error: ${error.message}` });

    await logAudit(req.userId, req.userEmail, 'user.password_reset', id, {});

    res.json({ message: 'Password reset email sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /activity ───────────────────────────────────────────────────────────

async function getActivity(req, res) {
  try {
    const { action, from, to, page = 1, limit = 50 } = req.query;
    const conditions = [];
    const params = [];

    if (action) {
      params.push(action);
      conditions.push(`al.action = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`al.created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to);
      conditions.push(`al.created_at <= $${params.length}::timestamptz`);
    }

    if (req.appRole === 'tecnico_municipal') {
      params.push(req.appMunicipio);
      conditions.push(
        `(al.target_type = 'user' AND al.target_id IN (
          SELECT id::text FROM user_roles WHERE fk_municipio = $${params.length}
        ))`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_log al ${where}`, params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    params.push(offset);
    const { rows } = await pool.query(
      `SELECT al.id, al.actor_id, al.actor_email, al.action, al.target_type, al.target_id,
              al.details, al.created_at
       FROM audit_log al
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getMe, listUsers, getUserById, inviteUser, updateUser,
  deactivateUser, reactivateUser, resendInvite, resetPassword, getActivity
};
