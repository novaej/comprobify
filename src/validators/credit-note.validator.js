const { body } = require('express-validator');
const moment = require('moment');
const catalog = require('../models/catalog.model');

const createCreditNote = [
  body('documentType')
    .notEmpty()
    .isIn(['04'])
    .withMessage('documentType is required and must be a supported document type code'),

  body('issueDate')
    .optional()
    .matches(/^\d{2}\/\d{2}\/\d{4}$/)
    .withMessage('Issue date must be in DD/MM/YYYY format')
    .bail()
    .custom((value) => {
      if (value !== moment().utcOffset(-5).format('DD/MM/YYYY')) {
        throw new Error('Issue date must be today — SRI rejects past and future dates');
      }
      return true;
    }),

  body('buyer').notEmpty().withMessage('Buyer is required'),
  body('buyer.idType')
    .isLength({ min: 2, max: 2 })
    .isNumeric()
    .withMessage('Buyer idType must be 2 digits')
    .custom(async (value) => {
      if (!(await catalog.isValidIdType(value))) {
        throw new Error(`Invalid buyer idType: ${value}`);
      }
    }),
  body('buyer.id')
    .notEmpty()
    .isLength({ max: 20 })
    .withMessage('Buyer id is required and must be max 20 characters'),
  body('buyer.name')
    .notEmpty()
    .isLength({ max: 300 })
    .withMessage('Buyer name is required and must be max 300 characters'),
  body('buyer.email')
    .notEmpty()
    .isEmail()
    .withMessage('Buyer email is required and must be a valid email address'),
  body('buyer.address')
    .optional()
    .isLength({ max: 300 }),

  body('originalDocument').notEmpty().withMessage('originalDocument is required'),
  body('originalDocument.documentType')
    .notEmpty()
    .isLength({ min: 2, max: 2 })
    .withMessage('originalDocument.documentType must be a 2-digit SRI document type code')
    .custom(async (value) => {
      if (!(await catalog.isValidDocumentType(value))) {
        throw new Error(`Invalid originalDocument.documentType: ${value}`);
      }
    }),
  body('originalDocument.number')
    .notEmpty()
    .matches(/^\d{3}-\d{3}-\d{9}$/)
    .withMessage('originalDocument.number must be in format NNN-NNN-NNNNNNNNN'),
  body('originalDocument.issueDate')
    .notEmpty()
    .matches(/^\d{2}\/\d{2}\/\d{4}$/)
    .withMessage('originalDocument.issueDate must be in DD/MM/YYYY format'),

  body('motivo')
    .notEmpty()
    .isLength({ max: 300 })
    .withMessage('motivo is required and must be max 300 characters'),

  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  body('items.*.mainCode')
    .notEmpty()
    .withMessage('Item mainCode is required'),
  body('items.*.description')
    .notEmpty()
    .isLength({ max: 300 })
    .withMessage('Item description is required'),
  body('items.*.quantity')
    .notEmpty()
    .isNumeric()
    .withMessage('Item quantity must be numeric'),
  body('items.*.unitPrice')
    .notEmpty()
    .isNumeric()
    .withMessage('Item unitPrice must be numeric'),
  body('items.*.discount')
    .optional()
    .isNumeric()
    .withMessage('Item discount must be numeric'),

  body('items.*.taxes')
    .isArray({ min: 1 })
    .withMessage('At least one tax per item is required'),
  body('items.*.taxes.*.code')
    .notEmpty()
    .withMessage('Tax code is required')
    .custom(async (value) => {
      if (!(await catalog.isValidTaxType(value))) {
        throw new Error(`Invalid tax code: ${value}`);
      }
    }),
  body('items.*.taxes.*.rateCode')
    .notEmpty()
    .withMessage('Tax rateCode is required'),

  // Validate code+rateCode pair together on the tax object
  body('items.*.taxes.*')
    .custom(async (tax) => {
      if (tax.code && tax.rateCode) {
        if (!(await catalog.isValidTaxRate(tax.code, tax.rateCode))) {
          throw new Error(`Invalid rateCode "${tax.rateCode}" for tax code "${tax.code}"`);
        }
      }
    }),
  body('items.*.taxes.*.rate')
    .notEmpty()
    .isNumeric()
    .withMessage('Tax rate must be numeric'),

  body('additionalInfo')
    .optional()
    .isArray(),
  body('additionalInfo.*.name')
    .notEmpty()
    .withMessage('Additional info name is required'),
  body('additionalInfo.*.value')
    .notEmpty()
    .withMessage('Additional info value is required'),
];

module.exports = { createCreditNote };
