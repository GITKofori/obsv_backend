const express = require("express");
const router = express.Router();
const sensoresController = require("../controllers/sensores.controller");

router.get("/", sensoresController.getAll);
router.get("/alertas", sensoresController.getAlertas);
router.put("/:id/leitura", sensoresController.updateLeitura);

module.exports = router;
