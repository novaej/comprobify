const { body, query } = require('express-validator');

const register = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('email must be a valid email address'),

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
    .optional()
    .notEmpty()
    .isString()
    .withMessage('each initialSequentials entry must have a non-empty documentType string'),

  body('initialSequentials.*.sequential')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a sequential >= 1'),

  body().custom((_, { req }) => {
    if (!req.file) throw new Error('A P12 certificate file is required');
    return true;
  }),
];

const verifyEmail = [
  query('token')
    .notEmpty()
    .isHexadecimal()
    .isLength({ min: 64, max: 64 })
    .withMessage('token must be a 64-character hex string'),
];

const resendVerification = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('email must be a valid email address'),
];

module.exports = { register, resendVerification, verifyEmail };
