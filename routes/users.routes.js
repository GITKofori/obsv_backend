'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/users.controller');
const { authorize } = require('../middleware/rbac');

// /api/protected/users — accessible to all authenticated users
// authorize() triggers lazy activation, email sync, and deactivated blocking
router.get('/me', authorize('cimat_admin', 'tecnico_municipal', 'parceiro_externo'), ctrl.getMe);

// /api/protected/admin/users — management endpoints
const adminRouter = express.Router();
adminRouter.get('/', authorize('cimat_admin', 'tecnico_municipal'), ctrl.listUsers);
adminRouter.get('/activity', authorize('cimat_admin', 'tecnico_municipal'), ctrl.getActivity);
adminRouter.get('/:id', authorize('cimat_admin', 'tecnico_municipal'), ctrl.getUserById);
adminRouter.post('/invite', authorize('cimat_admin', 'tecnico_municipal'), ctrl.inviteUser);
adminRouter.put('/:id', authorize('cimat_admin', 'tecnico_municipal'), ctrl.updateUser);
adminRouter.put('/:id/deactivate', authorize('cimat_admin', 'tecnico_municipal'), ctrl.deactivateUser);
adminRouter.put('/:id/reactivate', authorize('cimat_admin', 'tecnico_municipal'), ctrl.reactivateUser);
adminRouter.post('/:id/resend-invite', authorize('cimat_admin', 'tecnico_municipal'), ctrl.resendInvite);
adminRouter.post('/:id/reset-password', authorize('cimat_admin', 'tecnico_municipal'), ctrl.resetPassword);

module.exports = { userRouter: router, adminUserRouter: adminRouter };
