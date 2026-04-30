const { body, param } = require('express-validator');
const TIERS = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const { SUPPORTED_TYPES } = require('../builders');

// Tenants
const createTenant = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('email must be a valid email address'),

  body('subscriptionTier')
    .optional()
    .isIn(Object.keys(TIERS))
    .withMessage(`subscriptionTier must be one of: ${Object.keys(TIERS).join(', ')}`),
];

const updateTenantTier = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('subscriptionTier')
    .isIn(Object.keys(TIERS))
    .withMessage(`subscriptionTier must be one of: ${Object.keys(TIERS).join(', ')}`),
];

const updateTenantStatus = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('status')
    .isIn(Object.values(TenantStatus))
    .withMessage(`status must be one of: ${Object.values(TenantStatus).join(', ')}`),
];

const verifyTenant = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

// Issuers
const createIssuer = [
  body('tenantId')
    .isInt({ min: 1 })
    .withMessage('tenantId must be a positive integer'),

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
    .withMessage('sandbox must be a boolean'),

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

  body('documentTypes')
    .optional()
    .customSanitizer(value => {
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
    })
    .isArray({ min: 1 })
    .withMessage('documentTypes must be a non-empty array'),

  body('documentTypes.*')
    .optional()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),

  body().custom((_, { req }) => {
    const hasFile = !!req.file;
    const hasSource = !!req.body.sourceIssuerId;
    if (!hasFile && !hasSource) throw new Error('Either a cert file upload or sourceIssuerId must be provided');
    if (hasFile && hasSource) throw new Error('Provide either a cert file upload or sourceIssuerId, not both');
    return true;
  }),
];

const promoteIssuer = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

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

// API keys
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
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

module.exports = {
  createTenant, updateTenantTier, updateTenantStatus, verifyTenant,
  createIssuer, promoteIssuer, createApiKey, revokeApiKey,
};
