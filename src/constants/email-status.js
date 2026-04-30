const EmailStatus = Object.freeze({
  PENDING:   'PENDING',
  SENT:      'SENT',
  FAILED:    'FAILED',
  DELIVERED: 'DELIVERED',
  COMPLAINED: 'COMPLAINED',
  SKIPPED:   'SKIPPED',
});

module.exports = EmailStatus;
