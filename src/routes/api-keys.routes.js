const { Router } = require('express');
const { body, param } = require('express-validator');
const controller = require('../controllers/api-key.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');

const router = Router();

router.use(authenticate);

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
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

router.get('/', readLimiter, asyncHandler(controller.list));
router.post('/', writeLimiter, createValidator, validateRequest, asyncHandler(controller.create));
router.delete('/:id', writeLimiter, idParam, validateRequest, asyncHandler(controller.revoke));

module.exports = router;
