const { body, param } = require('express-validator');
const NotificationTypes = require('../constants/notification-types');

const ALL_EVENT_TYPES = Object.values(NotificationTypes);

const idValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Webhook endpoint id must be a positive integer'),
];

const createValidator = [
  body('url')
    .isURL({ protocols: ['https'], require_tld: true, require_protocol: true })
    .withMessage('url must be a valid HTTPS URL'),

  body('eventTypes')
    .optional()
    .isArray()
    .withMessage('eventTypes must be an array'),

  body('eventTypes.*')
    .optional()
    .isIn(ALL_EVENT_TYPES)
    .withMessage(`Each eventType must be one of: ${ALL_EVENT_TYPES.join(', ')}`),
];

const updateValidator = [
  ...idValidator,

  body('url')
    .optional()
    .isURL({ protocols: ['https'], require_tld: true, require_protocol: true })
    .withMessage('url must be a valid HTTPS URL'),

  body('eventTypes')
    .optional()
    .isArray()
    .withMessage('eventTypes must be an array'),

  body('eventTypes.*')
    .optional()
    .isIn(ALL_EVENT_TYPES)
    .withMessage(`Each eventType must be one of: ${ALL_EVENT_TYPES.join(', ')}`),

  body('active')
    .optional()
    .isBoolean()
    .withMessage('active must be a boolean'),
];

module.exports = { idValidator, createValidator, updateValidator };
