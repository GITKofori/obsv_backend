const express = require("express");
const router = express.Router();
const c = require("../controllers/alertas-regras.controller");

// Alert rules CRUD
router.get("/regras", c.getAll);
router.post("/regras", c.create);
router.put("/regras/:id", c.update);
router.delete("/regras/:id", c.remove);
router.patch("/regras/:id/toggle", c.toggleAtivo);

// Triggered alerts
router.get("/disparados", c.getDisparados);
router.patch("/disparados/:id/reconhecer", c.reconhecer);
router.patch("/disparados/reconhecer-todos", c.reconhecerTodos);

module.exports = router;
