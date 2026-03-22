// backend/routes/gestao-validation.routes.js
'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gestao-validation.controller');
const { authorize } = require('../middleware/rbac');

// Available to all authenticated users
router.get('/pending-count', ctrl.getPendingCount);

// Municipal technicians can submit their own records
router.post('/:id/submit', ctrl.submit);

// Admin only
router.get('/pending', authorize('cimat_admin'), ctrl.getPending);
router.post('/:id/validate', authorize('cimat_admin'), ctrl.validateRecord);
router.post('/:id/reject', authorize('cimat_admin'), ctrl.reject);

module.exports = router;
