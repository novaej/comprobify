const { param } = require('express-validator');
const legalDocumentService = require('../services/legal-document.service');

const getByType = [
  param('type')
    .isIn(legalDocumentService.DOCUMENT_TYPES)
    .withMessage(`type must be one of: ${legalDocumentService.DOCUMENT_TYPES.join(', ')}`),
];

module.exports = { getByType };
