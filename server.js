const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();

app.use(express.json());
app.use(cors());

const { authenticateToken, authenticateSSE } = require("./middleware/authJWT");

const telemetryRoutes = require("./routes/telemetry.routes");
const pmacRoutes = require("./routes/pmac.routes");
const validacaoRoutes = require("./routes/validacao.routes");
const sensoresRoutes = require("./routes/sensores.routes");
const dashboardPmacRoutes = require("./routes/dashboard-pmac.routes");
const alertasRegrasRoutes = require("./routes/alertas-regras.routes");
const scraperRoutes = require("./routes/scraper.routes");
const dgegScraperRoutes = require('./routes/dgeg-scraper.routes');
const coreEnergyRoutes = require('./routes/core-energy.routes');
const gestaoValidationRoutes = require('./routes/gestao-validation.routes');
const { userRouter, adminUserRouter } = require('./routes/users.routes');

// SSE stream uses query-param token auth (EventSource can't set headers)
app.get(
  "/api/protected/sensores/stream",
  authenticateSSE,
  require("./controllers/sensores.controller").streamSSE
);

app.use("/api/protected", authenticateToken, telemetryRoutes);
app.use("/api/protected/pmac", authenticateToken, pmacRoutes);
app.use("/api/protected/validacao", authenticateToken, validacaoRoutes);
app.use("/api/protected/sensores", authenticateToken, sensoresRoutes);
app.use("/api/protected/dashboard-pmac", authenticateToken, dashboardPmacRoutes);
app.use("/api/protected/alertas", authenticateToken, alertasRegrasRoutes);
app.use("/api/protected/admin/scrapers", authenticateToken, scraperRoutes);
app.use("/api/protected/admin/scrapers/dgeg-energy", authenticateToken, dgegScraperRoutes);
app.use('/api/protected/core', authenticateToken, coreEnergyRoutes);
app.use('/api/protected/gestao', authenticateToken, gestaoValidationRoutes);
app.use('/api/protected/users', authenticateToken, userRouter);
app.use('/api/protected/admin/users', authenticateToken, adminUserRouter);

app.listen(8080, () => {
  console.log("Server running on port 8080");

  // Start MQTT client (connects to HiveMQ broker)
  const mqttService = require("./services/mqtt.service");
  mqttService.init();

  // Start periodic aggregated alert evaluation (every 2 min)
  const alertService = require("./services/alert.service");
  alertService.startPeriodicEvaluation();
});
