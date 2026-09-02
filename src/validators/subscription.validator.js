const { body } = require('express-validator');
const { TIERS } = require('../constants/subscription-tiers');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');

const changeTier = [
  body('tier')
    .isIn(PAID_TIERS)
    .withMessage(`tier must be one of: ${PAID_TIERS.join(', ')}`),

  body('billingInterval')
    .optional()
    .isIn(['MONTHLY', 'YEARLY'])
    .withMessage('billingInterval must be one of: MONTHLY, YEARLY'),
];

const createSubscription = [
  body('tier')
    .isIn(PAID_TIERS)
    .withMessage(`tier must be one of: ${PAID_TIERS.join(', ')}`),

  body('billingInterval')
    .optional()
    .isIn(['MONTHLY', 'YEARLY'])
    .withMessage('billingInterval must be one of: MONTHLY, YEARLY'),
];

// extraSeats is the ABSOLUTE target count, not a delta — mirrors `tier`
// above. .toInt() matters: without it, requestSeatChange's no-op check
// (extraSeats === subscription.extra_seats) would compare a string to a
// number and never match.
const changeSeats = [
  body('extraSeats')
    .isInt({ min: 0, max: 100 })
    .withMessage('extraSeats must be an integer between 0 and 100')
    .toInt(),
];

module.exports = { changeTier, createSubscription, changeSeats };
