const express = require("express");
const router = express.Router();
const municipiosController = require("../controllers/municipios.controller");
const medidasController = require("../controllers/medidas.controller");
const indicadoresController = require("../controllers/indicadores.controller");
const execucaoController = require("../controllers/execucao.controller");
const { authorize } = require("../middleware/rbac");

// Municipios
router.get("/municipios", municipiosController.getAll);
router.get("/municipios/:id", municipiosController.getById);

// Medidas
router.get("/medidas", medidasController.getAll);
router.get("/medidas/:id", medidasController.getById);
router.post("/medidas", authorize("cimat_admin", "tecnico_municipal"), medidasController.create);
router.put("/medidas/:id", authorize("cimat_admin", "tecnico_municipal"), medidasController.update);
router.delete("/medidas/:id", authorize("cimat_admin"), medidasController.remove);

// Indicadores
router.get("/indicadores", indicadoresController.getByMedida);
router.post("/indicadores", authorize("cimat_admin", "tecnico_municipal"), indicadoresController.create);
router.put("/indicadores/:id", authorize("cimat_admin", "tecnico_municipal"), indicadoresController.update);
router.delete("/indicadores/:id", authorize("cimat_admin"), indicadoresController.remove);

// Execucao
router.get("/execucao", execucaoController.getByIndicador);
router.post("/execucao", authorize("cimat_admin", "tecnico_municipal", "parceiro_externo"), execucaoController.create);

module.exports = router;
