const { body, param, query } = require('express-validator');
const TIERS = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const { SUPPORTED_TYPES } = require('../builders');
const agreementService = require('../services/agreement.service');

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

const renewIssuerCertificate = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

const promoteTenant = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('initialSequentials')
    .optional()
    .isArray({ min: 1 })
    .withMessage('initialSequentials must be a non-empty array'),

  body('initialSequentials.*.issuerId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a positive integer issuerId'),

  body('initialSequentials.*.documentType')
    .optional()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each initialSequentials entry documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),

  body('initialSequentials.*.sequential')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a sequential >= 1'),
];

// API keys
const createApiKey = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('label')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('label must be a string of max 100 characters'),

  body('environment')
    .optional()
    .isIn(['sandbox', 'production'])
    .withMessage(`environment must be 'sandbox' or 'production'`),

  body('revokeExisting')
    .optional()
    .isBoolean()
    .withMessage('revokeExisting must be a boolean'),
];

const revokeApiKey = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

// Subscriptions & payments
const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');

const createSubscription = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('tier')
    .isIn(PAID_TIERS)
    .withMessage(`tier must be one of: ${PAID_TIERS.join(', ')}`),

  body('billingInterval')
    .optional()
    .isIn(['MONTHLY', 'YEARLY'])
    .withMessage(`billingInterval must be one of: MONTHLY, YEARLY`),
];

const listSubscriptions = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

const linkInvoice = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('accessKey')
    .isLength({ min: 49, max: 49 })
    .withMessage('accessKey must be exactly 49 digits')
    .isNumeric()
    .withMessage('accessKey must contain only digits'),
];

const cancelSubscription = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

const reviewPayment = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),

  body('decision')
    .isIn(['VERIFIED', 'REJECTED'])
    .withMessage('decision must be one of: VERIFIED, REJECTED'),

  body('rejectionReason')
    .if(body('decision').equals('REJECTED'))
    .notEmpty()
    .withMessage('rejectionReason is required when decision is REJECTED — the tenant needs to know what to fix before re-uploading'),

  body('rejectionReason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('rejectionReason must be a string of max 500 characters'),
];

const getPaymentProof = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
];

const listPayments = [
  query('status')
    .optional()
    .isIn(['PENDING', 'REPORTED', 'VERIFIED', 'REJECTED'])
    .withMessage('status must be one of: PENDING, REPORTED, VERIFIED, REJECTED'),
];

const publishAgreement = [
  body('documentType')
    .isIn(agreementService.AGREEMENT_TYPES)
    .withMessage(`documentType must be one of: ${agreementService.AGREEMENT_TYPES.join(', ')}`),

  body('version')
    .notEmpty()
    .isLength({ max: 50 })
    .withMessage('version is required and must be max 50 characters'),
];

module.exports = {
  createTenant, updateTenantTier, updateTenantStatus, verifyTenant, promoteTenant,
  createIssuer, renewIssuerCertificate, createApiKey, revokeApiKey,
  createSubscription, listSubscriptions, linkInvoice, cancelSubscription,
  reviewPayment, getPaymentProof, listPayments, publishAgreement,
  activateAgreement: [param('id').isInt({ min: 1 }).withMessage('id must be a positive integer')],
  listAgreementVersions: [param('type').isIn(agreementService.AGREEMENT_TYPES).withMessage('type must be TERMS, PRIVACY or DPA')],
};
