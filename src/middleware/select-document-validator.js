const { body } = require('express-validator');
const { createInvoice } = require('../validators/invoice.validator');
const { createCreditNote } = require('../validators/credit-note.validator');
const { SUPPORTED_TYPES } = require('../builders');

const validatorsByType = {
  '01': createInvoice,
  '04': createCreditNote,
};

// Request bodies differ by document type (e.g. credit notes have no `payments` block but
// require `originalDocument` + `motivo`), so there is no single shared validator chain —
// pick the right one based on the documentType the caller sent.
const unsupportedTypeChain = [
  body('documentType')
    .isIn(SUPPORTED_TYPES)
    .withMessage(`documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),
];

async function selectDocumentValidator(req, res, next) {
  const chain = validatorsByType[req.body.documentType] || unsupportedTypeChain;
  await Promise.all(chain.map((validator) => validator.run(req)));
  next();
}

module.exports = selectDocumentValidator;
