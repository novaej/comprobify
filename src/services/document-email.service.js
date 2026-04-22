const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const emailService = require('./email.service');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');
const EventType = require('../constants/event-type');

async function retryFailedEmails(issuer) {
  const documents = await documentModel.findPendingEmails(issuer.id, issuer.sandbox);
  const result = { sent: 0, failed: 0 };

  for (const doc of documents) {
    try {
      const { messageId } = await emailService.sendInvoiceAuthorized(doc);
      await documentModel.updateStatus(doc.id, doc.status, {
        email_status: 'SENT',
        email_sent_at: new Date(),
        email_error: null,
        email_message_id: messageId,
      }, issuer.id, issuer.sandbox);
      await documentEventModel.create(doc.id, EventType.EMAIL_SENT,
        null, null, { to: doc.buyer_email, retried: true }, null, issuer.id, issuer.sandbox);
      result.sent++;
    } catch (err) {
      await documentModel.updateStatus(doc.id, doc.status, {
        email_status: 'FAILED',
        email_error: err.message,
      }, issuer.id, issuer.sandbox);
      await documentEventModel.create(doc.id, EventType.EMAIL_FAILED,
        null, null, { error: err.message, retried: true }, null, issuer.id, issuer.sandbox);
      result.failed++;
    }
  }

  return result;
}

async function retrySingleEmail(accessKey, { force = false } = {}, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== DocumentStatus.AUTHORIZED) {
    throw new AppError(`Cannot send email for document with status ${document.status}. Must be ${DocumentStatus.AUTHORIZED}.`, 400);
  }
  if (!document.buyer_email) {
    await documentModel.updateStatus(document.id, document.status, { email_status: 'SKIPPED' }, issuer.id, issuer.sandbox);
    return { sent: false, reason: 'no_email' };
  }
  if (document.email_status === 'SENT' && !force) {
    return { sent: false, reason: 'already_sent' };
  }

  try {
    const { messageId } = await emailService.sendInvoiceAuthorized(document);
    await documentModel.updateStatus(document.id, document.status, {
      email_status: 'SENT',
      email_sent_at: new Date(),
      email_error: null,
      email_message_id: messageId,
    }, issuer.id, issuer.sandbox);
    await documentEventModel.create(document.id, EventType.EMAIL_SENT,
      null, null, { to: document.buyer_email, retried: true }, null, issuer.id, issuer.sandbox);
    return { sent: true };
  } catch (err) {
    await documentModel.updateStatus(document.id, document.status, {
      email_status: 'FAILED',
      email_error: err.message,
    }, issuer.id, issuer.sandbox);
    await documentEventModel.create(document.id, EventType.EMAIL_FAILED,
      null, null, { error: err.message, retried: true }, null, issuer.id, issuer.sandbox);
    throw err;
  }
}

module.exports = { retryFailedEmails, retrySingleEmail };
