const { body } = require('express-validator');

const createInvoice = [
  body('issueDate')
    .optional()
    .matches(/^\d{2}\/\d{2}\/\d{4}$/)
    .withMessage('Issue date must be in DD/MM/YYYY format'),

  body('buyer').notEmpty().withMessage('Buyer is required'),
  body('buyer.idType')
    .isLength({ min: 2, max: 2 })
    .isNumeric()
    .withMessage('Buyer idType must be 2 digits'),
  body('buyer.id')
    .notEmpty()
    .isLength({ max: 20 })
    .withMessage('Buyer id is required and must be max 20 characters'),
  body('buyer.name')
    .notEmpty()
    .isLength({ max: 300 })
    .withMessage('Buyer name is required and must be max 300 characters'),
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
    .withMessage('Tax code is required'),
  body('items.*.taxes.*.rateCode')
    .notEmpty()
    .withMessage('Tax rateCode is required'),
  body('items.*.taxes.*.rate')
    .notEmpty()
    .isNumeric()
    .withMessage('Tax rate must be numeric'),
  body('items.*.taxes.*.taxBase')
    .notEmpty()
    .isNumeric()
    .withMessage('Tax base must be numeric'),
  body('items.*.taxes.*.value')
    .notEmpty()
    .isNumeric()
    .withMessage('Tax value must be numeric'),

  body('payments')
    .isArray({ min: 1 })
    .withMessage('At least one payment is required'),
  body('payments.*.method')
    .notEmpty()
    .isLength({ min: 2, max: 2 })
    .withMessage('Payment method must be 2 digits'),
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
