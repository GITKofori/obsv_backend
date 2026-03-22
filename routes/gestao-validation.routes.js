// backend/routes/gestao-validation.routes.js
'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gestao-validation.controller');
const { authorize } = require('../middleware/rbac');

// Available to admins and municipal technicians
router.get('/pending-count', authorize('cimat_admin', 'tecnico_municipal'), ctrl.getPendingCount);

// Municipal technicians can submit their own records
router.post('/:id/submit', ctrl.submit);

// Admin and tecnico_municipal (scoped to their municipality)
router.get('/pending', authorize('cimat_admin', 'tecnico_municipal'), ctrl.getPending);
router.post('/:id/validate', authorize('cimat_admin', 'tecnico_municipal'), ctrl.validateRecord);
router.post('/:id/reject', authorize('cimat_admin', 'tecnico_municipal'), ctrl.reject);

module.exports = router;
