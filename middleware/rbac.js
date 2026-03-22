const pool = require('../util/db');

const getUserRole = async (supabaseUserId) => {
  const result = await pool.query(
    'SELECT id, role, fk_municipio, medidas_atribuidas, estado, email FROM user_roles WHERE supabase_user_id = $1',
    [supabaseUserId]
  );
  return result.rows[0] || null;
};

const authorize = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userRole = await getUserRole(req.userId);
      if (!userRole) {
        return res.status(403).json({ error: 'No role assigned to this user' });
      }

      // Block deactivated accounts
      if (userRole.estado === 'desativado') {
        return res.status(403).json({ error: 'Account deactivated' });
      }

      // Lazy activation: first login after accepting invite
      if (userRole.estado === 'convidado') {
        await pool.query(
          'UPDATE user_roles SET estado = $1, updated_at = NOW() WHERE id = $2',
          ['ativo', userRole.id]
        );
        await pool.query(
          `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.userId, req.userEmail, 'user.activated', 'user', String(userRole.id), '{}']
        );
      }

      // Sync email from JWT (keeps denormalized copy current)
      if (userRole.email !== req.userEmail) {
        await pool.query(
          'UPDATE user_roles SET email = $1, updated_at = NOW() WHERE id = $2',
          [req.userEmail, userRole.id]
        );
      }

      if (!allowedRoles.includes(userRole.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      req.appRole = userRole.role;
      req.appMunicipio = userRole.fk_municipio;
      req.appMedidasAtribuidas = userRole.medidas_atribuidas || [];
      next();
    } catch (err) {
      console.error('Authorization check failed:', err.message);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
};

/**
 * Enforce municipality scope for tecnico_municipal.
 * cimat_admin bypasses; tecnico must match targetMunicipioId.
 * Returns true if OK, false if response was sent.
 */
function enforceMunicipalScope(req, res, targetMunicipioId) {
  if (req.appRole === 'cimat_admin') return true;
  if (req.appRole === 'tecnico_municipal' && req.appMunicipio === targetMunicipioId) return true;
  res.status(403).json({ error: 'Access denied: municipality scope violation' });
  return false;
}

module.exports = { authorize, getUserRole, enforceMunicipalScope };
