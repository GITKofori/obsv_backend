const mqtt = require("mqtt");
const pool = require("../util/db");
const alertService = require("./alert.service");

// ─── Broker config ────────────────────────────────────────────────────────────
const BROKER_URL =
  "mqtts://bdc2ce9fcbb746e8afa1ef123524ec99.s1.eu.hivemq.cloud:8883";

const MQTT_OPTIONS = {
  username: "cimat_user",
  password: "xNuwvwZkejpLWZ6rNFg6",
  protocol: "mqtts",
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  keepalive: 30,
  clean: false,
  clientId: `observatorio_clima_${Math.random().toString(16).slice(2, 8)}`,
};

const TOPICS = [
  "cimat/point1/t1",
  "cimat/point1/t2",
  "cimat/point2/t1",
  "cimat/point2/t2",
  "cimat/point3/t2",
];

// ─── In-memory state ──────────────────────────────────────────────────────────
let latestState = {
  point1: { t1: null, t2: null },
  point2: { t1: null, t2: null },
  point3: { t1: null, t2: null },
};

let connected = false;

// ─── Message counters (for diagnostics) ──────────────────────────────────────
const msgCount = { t1: 0, t2: 0, errors: 0, dbErrors: 0 };

// ─── SSE client registry ──────────────────────────────────────────────────────
const sseClients = new Set();

function addSSEClient(res) {
  sseClients.add(res);
}

function removeSSEClient(res) {
  sseClients.delete(res);
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ─── Public getters ───────────────────────────────────────────────────────────
function getLatestState() {
  return { ...latestState, connected };
}

function isConnected() {
  return connected;
}

// ─── Timestamp extractor ──────────────────────────────────────────────────────
// Handles both "Timestamp" and "timestamp" key names from hardware
function extractTimestamp(payload) {
  const ts = payload.Timestamp ?? payload.timestamp ?? null;
  if (!ts) {
    console.warn("[MQTT] Payload has no Timestamp field. Keys:", Object.keys(payload).join(", "));
    return new Date().toISOString();
  }
  // Hardware sends Unix epoch seconds — convert to ISO string for PostgreSQL
  const numeric = Number(ts);
  if (!isNaN(numeric) && numeric > 1_000_000_000) {
    return new Date(numeric * 1000).toISOString();
  }
  return ts;
}

// ─── DB persistence ───────────────────────────────────────────────────────────
async function persistT1(parcela, timestamp, dados) {
  try {
    console.log(`[MQTT][DB] Inserting t1 | parcela=${parcela} ts=${timestamp}`);
    await pool.query(
      "INSERT INTO leituras_t1 (parcela, timestamp, dados) VALUES ($1, $2, $3::jsonb)",
      [parcela, timestamp, JSON.stringify(dados)]
    );
    console.log(`[MQTT][DB] t1 insert OK | parcela=${parcela}`);
  } catch (err) {
    msgCount.dbErrors++;
    console.error(`[MQTT][DB] t1 insert FAILED | parcela=${parcela} | ${err.message}`);
    // Log full detail for first 5 DB errors to avoid log spam
    if (msgCount.dbErrors <= 5) {
      console.error("[MQTT][DB] Full error:", err);
    }
  }
}

async function persistT2(parcela, timestamp, dados) {
  try {
    console.log(`[MQTT][DB] Inserting t2 | parcela=${parcela} ts=${timestamp} fields=${Object.keys(dados).join(",")}`);
    await pool.query(
      "INSERT INTO leituras_t2 (parcela, timestamp, dados) VALUES ($1, $2, $3::jsonb)",
      [parcela, timestamp, JSON.stringify(dados)]
    );
    console.log(`[MQTT][DB] t2 insert OK | parcela=${parcela}`);
  } catch (err) {
    msgCount.dbErrors++;
    console.error(`[MQTT][DB] t2 insert FAILED | parcela=${parcela} | ${err.message}`);
    if (msgCount.dbErrors <= 5) {
      console.error("[MQTT][DB] Full error:", err);
    }
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────
function init() {
  console.log("[MQTT] Connecting to HiveMQ broker...");
  const client = mqtt.connect(BROKER_URL, MQTT_OPTIONS);

  client.on("connect", () => {
    console.log("[MQTT] Connected");
    connected = true;
    broadcastSSE("status", { connected: true });

    client.subscribe(TOPICS, { qos: 0 }, (err) => {
      if (err) {
        console.error("[MQTT] Subscription error:", err.message);
      } else {
        console.log("[MQTT] Subscribed to:", TOPICS.join(", "));
      }
    });
  });

  client.on("reconnect", () => {
    console.log("[MQTT] Reconnecting...");
  });

  client.on("close", () => {
    console.warn("[MQTT] Connection closed — will retry in 5 s");
    connected = false;
    broadcastSSE("status", { connected: false });
  });

  client.on("offline", () => {
    console.warn("[MQTT] Offline");
    connected = false;
    broadcastSSE("status", { connected: false });
  });

  client.on("error", (err) => {
    console.error("[MQTT] Error:", err.message);
    connected = false;
  });

  client.on("message", async (topic, message) => {
    const raw = message.toString();
    console.log(`[MQTT] ← ${topic} | ${raw.length} bytes | raw: ${raw.slice(0, 120)}${raw.length > 120 ? "…" : ""}`);

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (parseErr) {
      msgCount.errors++;
      console.error(`[MQTT] JSON parse error on topic ${topic}:`, parseErr.message, "| raw:", raw.slice(0, 200));
      return;
    }

    try {
      const parts = topic.split("/");
      const parcela = parts[1];   // "point1", "point2", "point3"
      const topicType = parts[2]; // "t1" or "t2"
      const timestamp = extractTimestamp(payload);

      console.log(`[MQTT] Parsed | type=${topicType} parcela=${parcela} ts=${timestamp} fields=${Object.keys(payload).length}`);

      if (topicType === "t1") {
        msgCount.t1++;
        latestState[parcela] = { ...latestState[parcela], t1: payload };
        broadcastSSE("t1", { parcela, data: payload });
        await persistT1(parcela, timestamp, payload);
        await alertService.evaluateInstantRules("t1", parcela, payload);
      } else if (topicType === "t2") {
        msgCount.t2++;
        console.log(`[MQTT] t2 payload keys: ${Object.keys(payload).join(", ")}`);
        latestState[parcela] = { ...latestState[parcela], t2: payload };
        broadcastSSE("t2", { parcela, data: payload });
        await persistT2(parcela, timestamp, payload);
        await alertService.evaluateInstantRules("t2", parcela, payload);
        console.log(`[MQTT] t2 totals — received: ${msgCount.t2} dbErrors: ${msgCount.dbErrors}`);
      } else {
        console.warn(`[MQTT] Unknown topic type: ${topicType} on ${topic}`);
      }
    } catch (err) {
      msgCount.errors++;
      console.error(`[MQTT] Error processing message on ${topic}:`, err.message, err.stack);
    }
  });

  // Periodic stats log every 5 minutes
  setInterval(() => {
    console.log(
      `[MQTT][STATS] connected=${connected} t1=${msgCount.t1} t2=${msgCount.t2} errors=${msgCount.errors} dbErrors=${msgCount.dbErrors} sseClients=${sseClients.size}`
    );
  }, 5 * 60 * 1000);
}

module.exports = {
  init,
  getLatestState,
  isConnected,
  addSSEClient,
  removeSSEClient,
  broadcastSSE,
};
