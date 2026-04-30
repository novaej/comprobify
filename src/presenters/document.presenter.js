const moment = require('moment');
const EmailStatus = require('../constants/email-status');

function formatDocument(doc) {
  return {
    accessKey: doc.access_key,
    documentType: doc.document_type,
    sequential: String(doc.sequential).padStart(9, '0'),
    status: doc.status,
    issueDate: moment(doc.issue_date).format('DD/MM/YYYY'),
    total: doc.total,
    buyer: {
      id: doc.buyer_id,
      idType: doc.buyer_id_type,
      name: doc.buyer_name,
      email: doc.buyer_email,
    },
    ...(doc.authorization_number && { authorizationNumber: doc.authorization_number }),
    ...(doc.authorization_date && { authorizationDate: doc.authorization_date }),
    email: {
      status: doc.email_status || EmailStatus.PENDING,
      ...(doc.email_sent_at && { sentAt: doc.email_sent_at }),
      ...(doc.email_error && { error: doc.email_error }),
    },
  };
}

module.exports = { formatDocument };
