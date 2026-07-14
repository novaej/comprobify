const DocumentStatus = Object.freeze({
  SIGNED:         'SIGNED',
  PENDING_SEND:   'PENDING_SEND',
  RECEIVED:       'RECEIVED',
  RETURNED:       'RETURNED',
  AUTHORIZED:     'AUTHORIZED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
});

module.exports = DocumentStatus;
