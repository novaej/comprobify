const { body } = require('express-validator');
const catalog = require('../models/catalog.model');

const createInvoice = [
  body('documentType')
    .notEmpty()
    .isIn(['01'])
    .withMessage('documentType is required and must be a supported document type code'),

  body('issueDate')
    .optional()
    .matches(/^\d{2}\/\d{2}\/\d{4}$/)
    .withMessage('Issue date must be in DD/MM/YYYY format'),

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

  body('payments')
    .isArray({ min: 1 })
    .withMessage('At least one payment is required'),
  body('payments.*.method')
    .notEmpty()
    .isLength({ min: 2, max: 2 })
    .withMessage('Payment method must be 2 digits')
    .custom(async (value) => {
      if (!(await catalog.isValidPaymentMethod(value))) {
        throw new Error(`Invalid payment method: ${value}`);
      }
    }),
  body('payments.*.total')
    .notEmpty()
    .isNumeric()
    .withMessage('Payment total must be numeric'),

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

module.exports = { createInvoice };
