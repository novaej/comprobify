const { body } = require('express-validator');

const voidDocument = [
  body('reason')
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('reason is required and must be max 500 characters'),
  body('confirmedSriVoid')
    .isBoolean()
    .withMessage('confirmedSriVoid must be a boolean')
    .bail()
    .custom((value) => value === true)
    .withMessage('confirmedSriVoid must be true — void this document in SRI\'s own portal first'),
];

module.exports = { voidDocument };
