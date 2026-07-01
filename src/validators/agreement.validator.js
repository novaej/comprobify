const { param } = require('express-validator');
const agreementService = require('../services/agreement.service');

const getByType = [
  param('type')
    .isIn(agreementService.AGREEMENT_TYPES)
    .withMessage(`type must be one of: ${agreementService.AGREEMENT_TYPES.join(', ')}`),
];

module.exports = { getByType };
