const { Router } = require('express');
const { param, body } = require('express-validator');
const controller = require('../controllers/notification.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const NotificationTypes = require('../constants/notification-types');

const router = Router();

router.use(authenticate);
router.use(requireNotSuspended);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const idValidator = [
  param('id')
    .isUUID()
    .withMessage('Notification id must be a valid UUID'),
];

const preferencesValidator = [
  body()
    .isArray({ min: 1 })
    .withMessage('Body must be a non-empty array'),
  body('*.type')
    .isIn(Object.values(NotificationTypes))
    .withMessage(`Each type must be one of: ${Object.values(NotificationTypes).join(', ')}`),
  body('*.enabled')
    .isBoolean()
    .withMessage('Each enabled must be a boolean'),
];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET  /api/notifications              — list (optional X-Issuer-Id filter, optional ?sinceId=)
// POST /api/notifications/:id/read     — mark one notification as read
// GET  /api/notifications/preferences  — get tenant preference list
// PATCH /api/notifications/preferences — update preferences

router.get('/',              readLimiter,  asyncHandler(controller.list));
router.get('/preferences',   readLimiter,  asyncHandler(controller.getPreferences));
router.patch('/preferences',  writeLimiter, preferencesValidator, validateRequest, asyncHandler(controller.updatePreferences));
router.post('/:id/read',     writeLimiter, idValidator, validateRequest, asyncHandler(controller.markRead));

module.exports = router;
