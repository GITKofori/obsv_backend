// backend/routes/core-energy.routes.js
'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/core-energy.controller');

router.get('/summary', ctrl.summary);
router.get('/map', ctrl.map);

module.exports = router;
