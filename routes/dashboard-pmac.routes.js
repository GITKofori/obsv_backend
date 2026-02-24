const express = require("express");
const router = express.Router();
const dashboardPmacController = require("../controllers/dashboard-pmac.controller");

router.get("/trajetoria", dashboardPmacController.trajetoria);
router.get("/pmac-summary", dashboardPmacController.pmacSummary);
router.get("/user-role", dashboardPmacController.userRole);

module.exports = router;
