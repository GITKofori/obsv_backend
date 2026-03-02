const pool = require("../util/db");

// ─── Rule cache ───────────────────────────────────────────────────────────────
// Rules are cached in memory to avoid a DB query on every MQTT message.
// Invalidate after any create/update/delete via invalidateCache().
let cachedRules = [];
let cacheValid = false;

async function loadRules() {
  const { rows } = await pool.query(
    "SELECT * FROM alertas_regras WHERE ativo = true"
  );
  cachedRules = rows;
  cacheValid = true;
}

function invalidateCache() {
  cacheValid = false;
}

async function getRules() {
  if (!cacheValid) {
    await loadRules();
  }
  return cachedRules;
}

// ─── Cooldown tracker ─────────────────────────────────────────────────────────
// Key: "ruleId:parcela" → last triggered timestamp (ms)
// Prevents alert spam: same rule+parcela can only trigger once every 5 minutes.
const COOLDOWN_MS = 5 * 60 * 1000;
const cooldowns = new Map();

function isOnCooldown(ruleId, parcela) {
  const key = `${ruleId}:${parcela}`;
  const last = cooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function setCooldown(ruleId, parcela) {
  cooldowns.set(`${ruleId}:${parcela}`, Date.now());
}

// ─── Comparison helper ────────────────────────────────────────────────────────
function compare(value, operator, threshold) {
  switch (operator) {
    case ">":  return value > threshold;
    case "<":  return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    case "=":  return value === threshold;
    default:   return false;
  }
}

// ─── Trigger alert ────────────────────────────────────────────────────────────
// Inserts into alertas_disparados and broadcasts SSE event.
async function triggerAlert(rule, parcela, campo, valorMedido) {
  if (isOnCooldown(rule.id, parcela)) return;
  setCooldown(rule.id, parcela);

  try {
    const { rows } = await pool.query(
      `INSERT INTO alertas_disparados (fk_regra, parcela, campo, valor_medido)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [rule.id, parcela, campo, valorMedido]
    );

    // Broadcast SSE alerta event (mqtt.service imports would cause circular dep,
    // so we use a lazy require here)
    const mqttService = require("./mqtt.service");
    mqttService.broadcastSSE("alerta", {
      id: rows[0].id,
      regra: { id: rule.id, nome: rule.nome },
      parcela,
      campo,
      valor_medido: valorMedido,
      valor_threshold: rule.valor_threshold,
      operador: rule.operador,
      disparado_em: rows[0].disparado_em,
    });

    console.log(
      `[ALERT] Rule "${rule.nome}" triggered: ${campo} = ${valorMedido} ${rule.operador} ${rule.valor_threshold} @ ${parcela}`
    );
  } catch (err) {
    console.error("[ALERT] Error triggering alert:", err.message);
  }
}

// ─── Instant rule evaluation ──────────────────────────────────────────────────
// Called on every incoming MQTT message.
async function evaluateInstantRules(topicType, parcela, data) {
  try {
    const rules = await getRules();
    const applicableRules = rules.filter(
      (r) =>
        r.tipo === "instant" &&
        r.topico === topicType &&
        (r.parcela === "all" || r.parcela === parcela)
    );

    for (const rule of applicableRules) {
      const rawValue = data[rule.campo];
      if (rawValue === undefined || rawValue === null) continue;

      const value = parseFloat(rawValue);
      if (isNaN(value)) continue;

      if (compare(value, rule.operador, parseFloat(rule.valor_threshold))) {
        await triggerAlert(rule, parcela, rule.campo, value);
      }
    }
  } catch (err) {
    console.error("[ALERT] Error evaluating instant rules:", err.message);
  }
}

// ─── Aggregated rule evaluation ───────────────────────────────────────────────
// Called periodically (every 2 minutes) for all active aggregated rules.
async function evaluateAggregatedRules() {
  try {
    const rules = await getRules();
    const aggregatedRules = rules.filter((r) => r.tipo === "aggregated");
    if (aggregatedRules.length === 0) return;

    for (const rule of aggregatedRules) {
      const parcelas =
        rule.parcela === "all"
          ? ["point1", "point2", "point3"]
          : [rule.parcela];

      for (const parcela of parcelas) {
        await evaluateOneAggregatedRule(rule, parcela);
      }
    }
  } catch (err) {
    console.error("[ALERT] Error evaluating aggregated rules:", err.message);
  }
}

async function evaluateOneAggregatedRule(rule, parcela) {
  try {
    const table = rule.topico === "t1" ? "leituras_t1" : "leituras_t2";
    const interval = `${rule.intervalo_minutos} minutes`;
    const fn = rule.funcao_agregacao; // avg, sum, min, max

    const { rows } = await pool.query(
      `SELECT ${fn}((dados->>'${rule.campo}')::decimal) AS valor
       FROM ${table}
       WHERE parcela = $1
         AND timestamp >= NOW() - $2::interval
         AND dados ? $3`,
      [parcela, interval, rule.campo]
    );

    const valor = parseFloat(rows[0]?.valor);
    if (isNaN(valor)) return;

    if (compare(valor, rule.operador, parseFloat(rule.valor_threshold))) {
      await triggerAlert(rule, parcela, rule.campo, valor);
    }
  } catch (err) {
    console.error(
      `[ALERT] Aggregated rule ${rule.id} eval error for ${parcela}:`,
      err.message
    );
  }
}

// ─── Start periodic aggregated evaluation ────────────────────────────────────
const AGGREGATED_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

function startPeriodicEvaluation() {
  setInterval(evaluateAggregatedRules, AGGREGATED_INTERVAL_MS);
  console.log("[ALERT] Periodic aggregated rule evaluation started (every 2 min)");
}

module.exports = {
  evaluateInstantRules,
  evaluateAggregatedRules,
  startPeriodicEvaluation,
  invalidateCache,
};
