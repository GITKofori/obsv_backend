const express = require("express");
const router = express.Router();
const validacaoController = require("../controllers/validacao.controller");
const { authorize } = require("../middleware/rbac");

router.get("/pendentes", authorize("cimat_admin"), validacaoController.getPendentes);
router.put("/:id/aprovar", authorize("cimat_admin"), validacaoController.aprovar);
router.put("/:id/rejeitar", authorize("cimat_admin"), validacaoController.rejeitar);

module.exports = router;
