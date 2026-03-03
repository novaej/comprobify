const EventType = Object.freeze({
  CREATED:           'CREATED',
  SENT:              'SENT',
  STATUS_CHANGED:    'STATUS_CHANGED',
  ERROR:             'ERROR',
  REBUILT:           'REBUILT',
  EMAIL_SENT:        'EMAIL_SENT',
  EMAIL_FAILED:      'EMAIL_FAILED',
  EMAIL_DELIVERED:   'EMAIL_DELIVERED',
  EMAIL_TEMP_FAILED: 'EMAIL_TEMP_FAILED',
  EMAIL_COMPLAINED:  'EMAIL_COMPLAINED',
});

module.exports = EventType;
