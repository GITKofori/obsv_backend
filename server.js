const express = require("express");
const cors = require("cors");

const telemetryRoutes = require("./routes/telemetry.routes");
const { authenticateToken } = require("./middleware/authJWT");

const app = express();

require("dotenv").config();

app.use(express.json());
app.use(cors());

app.use("/api/protected", authenticateToken, telemetryRoutes);

const pmacRoutes = require("./routes/pmac.routes");
const validacaoRoutes = require("./routes/validacao.routes");
const sensoresRoutes = require("./routes/sensores.routes");
const dashboardPmacRoutes = require("./routes/dashboard-pmac.routes");

app.use("/api/protected/pmac", authenticateToken, pmacRoutes);
app.use("/api/protected/validacao", authenticateToken, validacaoRoutes);
app.use("/api/protected/sensores", authenticateToken, sensoresRoutes);
app.use("/api/protected/dashboard-pmac", authenticateToken, dashboardPmacRoutes);

app.listen(8080, () => console.log("Server running on port 8080"));
