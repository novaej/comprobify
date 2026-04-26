const { body, param } = require('express-validator');

const createIssuer = [
  body('ruc')
    .notEmpty()
    .matches(/^\d{13}$/)
    .withMessage('ruc must be a 13-digit number'),

  body('businessName')
    .notEmpty()
    .isLength({ max: 300 })
    .withMessage('businessName is required and must be max 300 characters'),

  body('branchCode')
    .notEmpty()
    .matches(/^\d{3}$/)
    .withMessage('branchCode must be a 3-digit string'),

  body('issuePointCode')
    .notEmpty()
    .matches(/^\d{3}$/)
    .withMessage('issuePointCode must be a 3-digit string'),

  body('environment')
    .isIn(['1', '2'])
    .withMessage('environment must be 1 (test) or 2 (production)'),

  body('emissionType')
    .isIn(['1'])
    .withMessage('emissionType must be 1'),

  body('requiredAccounting')
    .isBoolean()
    .withMessage('requiredAccounting must be a boolean'),

  body('sandbox')
    .optional()
    .isBoolean()
    .withMessage('sandbox must be a boolean (true = SRI test endpoint, false = SRI production endpoint)'),

  body('initialSequentials')
    .optional()
    .customSanitizer(value => {
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
    })
    .isArray({ min: 1 })
    .withMessage('initialSequentials must be a non-empty array'),

  body('initialSequentials.*.documentType')
    .notEmpty()
    .isString()
    .withMessage('each initialSequentials entry must have a non-empty documentType string'),

  body('initialSequentials.*.sequential')
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a sequential >= 1'),

  // Either a cert file upload or sourceIssuerId must be provided, but not both
  body().custom((_, { req }) => {
    const hasFile = !!req.file;
    const hasSource = !!req.body.sourceIssuerId;
    if (!hasFile && !hasSource) {
      throw new Error('Either a cert file upload or sourceIssuerId must be provided');
    }
    if (hasFile && hasSource) {
      throw new Error('Provide either a cert file upload or sourceIssuerId, not both');
    }
    return true;
  }),
];

const createApiKey = [
  body('label')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('label must be a string of max 100 characters'),

  body('revokeExisting')
    .optional()
    .isBoolean()
    .withMessage('revokeExisting must be a boolean'),
];

const revokeApiKey = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('id must be a positive integer'),
];

const promoteIssuer = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('id must be a positive integer'),
];

module.exports = { createIssuer, createApiKey, revokeApiKey, promoteIssuer };
