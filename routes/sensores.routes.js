const express = require("express");
const router = express.Router();
const sensoresController = require("../controllers/sensores.controller");

// Real-time SSE stream (token accepted from ?token= query param, see authJWT)
router.get("/stream", sensoresController.streamSSE);

// Latest in-memory state
router.get("/latest", sensoresController.getLatest);

// Historical readings (paginated)
router.get("/historico", sensoresController.getHistorico);

// Aggregated statistics
router.get("/stats", sensoresController.getStats);

// Legacy endpoints
router.get("/alertas", sensoresController.getAlertas);
router.get("/", sensoresController.getAll);
router.put("/:id/leitura", sensoresController.updateLeitura);

module.exports = router;
