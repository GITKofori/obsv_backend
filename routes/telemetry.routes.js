const express = require("express");
const router = express.Router();
const telemetryController = require("../controllers/telemetry.controller");

router.get("/dashboard", telemetryController.dashboard);
router.get("/types", telemetryController.types);
router.get("/metrics", telemetryController.metrics);
router.get("/charts", telemetryController.charts);
router.get("/:municipio/metrics", telemetryController.municipioStatistics);

module.exports = router;
