const EventType = Object.freeze({
  CREATED:        'CREATED',
  SENT:           'SENT',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ERROR:          'ERROR',
  REBUILT:        'REBUILT',
});

module.exports = EventType;
