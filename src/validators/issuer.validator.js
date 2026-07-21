const { body } = require('express-validator');
const { SUPPORTED_TYPES } = require('../builders');

function arrayFromJsonString(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

const createBranch = [
  body('sourceIssuerId')
    .optional()
    .isUUID()
    .withMessage('sourceIssuerId must be a valid UUID'),

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
    .customSanitizer(arrayFromJsonString)
    .isArray({ min: 1 })
    .withMessage('documentTypes must be a non-empty array'),

  body('documentTypes.*')
    .optional()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),

  body('initialSequentials')
    .optional()
    .customSanitizer(arrayFromJsonString)
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

const updateIssuer = [
  body('tradeName')
    .optional()
    .isString()
    .isLength({ max: 300 })
    .withMessage('tradeName must be a string of max 300 characters'),

  body('branchAddress')
    .optional()
    .isString()
    .isLength({ max: 300 })
    .withMessage('branchAddress must be a string of max 300 characters'),

  body().custom((_value, { req }) => {
    if (req.body.tradeName === undefined && req.body.branchAddress === undefined) {
      throw new Error('At least one of tradeName or branchAddress must be provided');
    }
    return true;
  }),
];

const setSequential = [
  body('environment')
    .isIn(['sandbox', 'production'])
    .withMessage("environment must be 'sandbox' or 'production'"),

  body('nextSequential')
    .isInt({ min: 1 })
    .withMessage('nextSequential must be an integer >= 1'),
];

module.exports = { createBranch, updateIssuer, setSequential };
