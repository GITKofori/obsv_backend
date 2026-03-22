// backend/routes/dgeg-scraper.routes.js
'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dgeg-scraper.controller');
const { authorize } = require('../middleware/rbac');

router.post('/run',           authorize('cimat_admin'), ctrl.run);
router.get('/status/:runId',  authorize('cimat_admin'), ctrl.getStatus);
router.get('/runs',           authorize('cimat_admin'), ctrl.getRuns);

module.exports = router;
