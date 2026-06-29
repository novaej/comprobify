const { body } = require('express-validator');
const TIERS = require('../constants/subscription-tiers');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');

const changeTier = [
  body('tier')
    .isIn(PAID_TIERS)
    .withMessage(`tier must be one of: ${PAID_TIERS.join(', ')}`),
];

module.exports = { changeTier };
