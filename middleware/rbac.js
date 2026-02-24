const pool = require("../util/db");

const getUserRole = async (supabaseUserId) => {
  const result = await pool.query(
    "SELECT role, fk_municipio, medidas_atribuidas FROM user_roles WHERE supabase_user_id = $1",
    [supabaseUserId]
  );
  return result.rows[0] || null;
};

const authorize = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userRole = await getUserRole(req.userId);
      if (!userRole) {
        return res.status(403).json({ error: "No role assigned to this user" });
      }
      if (!allowedRoles.includes(userRole.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      req.appRole = userRole.role;
      req.appMunicipio = userRole.fk_municipio;
      req.appMedidasAtribuidas = userRole.medidas_atribuidas || [];
      next();
    } catch (err) {
      res.status(500).json({ error: "Authorization check failed" });
    }
  };
};

module.exports = { authorize, getUserRole };
