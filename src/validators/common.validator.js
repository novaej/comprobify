const { param, query } = require('express-validator');
const DocumentStatus = require('../constants/document-status');

const accessKeyParam = [
  param('accessKey')
    .isLength({ min: 49, max: 49 })
    .withMessage('Access key must be exactly 49 digits')
    .isNumeric()
    .withMessage('Access key must contain only digits'),
];

const listDocumentsQuery = [
  query('status')
    .optional()
    .isIn(Object.values(DocumentStatus))
    .withMessage('Status must be a valid document status'),
  query('from')
    .optional()
    .matches(/^\d{2}\/\d{2}\/\d{4}$/)
    .withMessage('From date must be in DD/MM/YYYY format'),
  query('to')
    .optional()
    .matches(/^\d{2}\/\d{2}\/\d{4}$/)
    .withMessage('To date must be in DD/MM/YYYY format'),
  query('documentType')
    .optional()
    .isIn(['01'])
    .withMessage('documentType must be a supported document type code'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

module.exports = { accessKeyParam, listDocumentsQuery };
