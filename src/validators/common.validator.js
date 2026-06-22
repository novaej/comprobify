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
    .isIn(['01', '03', '04', '05', '06', '07'])
    .withMessage('documentType must be a supported document type code'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('sortBy')
    .optional()
    .isIn(['sequential', 'buyerName', 'issueDate', 'status'])
    .withMessage('sortBy must be one of sequential, buyerName, issueDate, status'),
  query('sortDir')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('sortDir must be asc or desc'),
  query('sequential')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('sequential must not be empty'),
  query('buyerName')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('buyerName must not be empty'),
];

module.exports = { accessKeyParam, listDocumentsQuery };
