const moment = require('moment');

function formatDocument(doc) {
  return {
    accessKey: doc.access_key,
    sequential: String(doc.sequential).padStart(9, '0'),
    status: doc.status,
    issueDate: moment(doc.issue_date).format('DD/MM/YYYY'),
    total: doc.total,
    ...(doc.authorization_number && { authorizationNumber: doc.authorization_number }),
    ...(doc.authorization_date && { authorizationDate: doc.authorization_date }),
    email: {
      status: doc.email_status || 'PENDING',
      ...(doc.email_sent_at && { sentAt: doc.email_sent_at }),
      ...(doc.email_error && { error: doc.email_error }),
    },
  };
}

module.exports = { formatDocument };
