const { Router } = require('express');
const { body, param, query } = require('express-validator');
const controller = require('../controllers/api-key.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');

const router = Router();

router.use(authenticate);
router.use(requireNotSuspended);
router.use(requireNotPastDue);

const createValidator = [
  body('label')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('label must be a string of max 100 characters'),

  body('environment')
    .optional()
    .isIn(['sandbox', 'production'])
    .withMessage(`environment must be 'sandbox' or 'production'`),
];

const idParam = [
  param('id').isUUID().withMessage('id must be a valid UUID'),
];

const usageValidator = [
  ...idParam,
  query('days')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('days must be between 1 and 365'),
];

router.get('/', readLimiter, asyncHandler(controller.list));
router.post('/', writeLimiter, createValidator, validateRequest, asyncHandler(controller.create));
router.delete('/:id', writeLimiter, idParam, validateRequest, asyncHandler(controller.revoke));
router.get('/:id/usage', readLimiter, usageValidator, validateRequest, asyncHandler(controller.usage));

module.exports = router;
