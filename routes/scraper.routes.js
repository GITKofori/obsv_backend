'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scraper.controller');
const { authorize } = require('../middleware/rbac');

router.post('/run',            authorize('cimat_admin'), ctrl.run);
router.get('/status/:runId',   authorize('cimat_admin'), ctrl.getStatus);
router.get('/runs',            authorize('cimat_admin'), ctrl.getRuns);
router.post('/manual',         authorize('cimat_admin'), ctrl.uploadManual);

module.exports = router;
