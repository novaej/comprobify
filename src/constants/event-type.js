const EventType = Object.freeze({
  CREATED:        'CREATED',
  SENT:           'SENT',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ERROR:          'ERROR',
  REBUILT:        'REBUILT',
  EMAIL_SENT:     'EMAIL_SENT',
  EMAIL_FAILED:   'EMAIL_FAILED',
});

module.exports = EventType;
