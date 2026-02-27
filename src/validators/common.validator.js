const { param } = require('express-validator');

const accessKeyParam = [
  param('accessKey')
    .isLength({ min: 49, max: 49 })
    .withMessage('Access key must be exactly 49 digits')
    .isNumeric()
    .withMessage('Access key must contain only digits'),
];

module.exports = { accessKeyParam };
