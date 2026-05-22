const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  createSpinWheel,
  joinSpinWheel,
  startSpinWheel,
  getActiveWheel,
  getSpinWheel,
  getWheelHistory,
  getTransactions,
  getConfig,
  updateConfig,
  getAdminStats,
} = require('../controllers/spinWheel.controller');

// Spin Wheel routes
router.post('/', authenticate, authorize('ADMIN'), createSpinWheel);
router.get('/active', authenticate, getActiveWheel);
router.get('/history', authenticate, getWheelHistory);
router.get('/:id', authenticate, getSpinWheel);
router.post('/:id/join', authenticate, joinSpinWheel);
router.post('/:id/start', authenticate, authorize('ADMIN'), startSpinWheel);

// Transaction routes
router.get('/user/transactions', authenticate, getTransactions);

// Config routes (Admin only)
router.get('/admin/config', authenticate, authorize('ADMIN'), getConfig);
router.put('/admin/config/:key', authenticate, authorize('ADMIN'), updateConfig);
router.get('/admin/stats', authenticate, authorize('ADMIN'), getAdminStats);

module.exports = router;
