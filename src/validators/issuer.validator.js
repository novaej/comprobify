const { body } = require('express-validator');
const { SUPPORTED_TYPES } = require('../builders');

const createBranch = [
  body('sourceIssuerId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('sourceIssuerId must be a positive integer'),

  body('branchCode')
    .notEmpty()
    .matches(/^\d{3}$/)
    .withMessage('branchCode must be a 3-digit string'),

  body('issuePointCode')
    .notEmpty()
    .matches(/^\d{3}$/)
    .withMessage('issuePointCode must be a 3-digit string'),

  body('branchAddress')
    .optional()
    .isString()
    .isLength({ max: 300 })
    .withMessage('branchAddress must be a string of max 300 characters'),

  body('documentTypes')
    .optional()
    .isArray({ min: 1 })
    .withMessage('documentTypes must be a non-empty array'),

  body('documentTypes.*')
    .optional()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),

  body('initialSequentials')
    .optional()
    .isArray({ min: 1 })
    .withMessage('initialSequentials must be a non-empty array'),

  body('initialSequentials.*.documentType')
    .optional()
    .notEmpty()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each initialSequentials entry documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),

  body('initialSequentials.*.sequential')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a sequential >= 1'),
];

module.exports = { createBranch };
