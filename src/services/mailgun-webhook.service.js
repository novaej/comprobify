const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const EventType = require('../constants/event-type');

/**
 * Normalises Mailgun webhook payload across v3 and legacy formats.
 * Returns { event, messageId, recipient, severity } or null if unrecognised.
 */
function normalisePayload(body) {
  // v3 format: { 'event-data': { event, message: { headers: { 'message-id': ... } }, recipient, severity } }
  if (body['event-data']) {
    const data = body['event-data'];
    return {
      event:     data.event,
      messageId: data.message && data.message.headers && data.message.headers['message-id'],
      recipient: data.recipient,
      severity:  data.severity,
    };
  }

  // Legacy format: { event, 'message-id': ..., recipient, severity }
  return {
    event:     body.event,
    messageId: body['message-id'],
    recipient: body.recipient,
    severity:  body.severity,
  };
}

/**
 * Processes a single Mailgun delivery webhook event.
 *
 * Handled events:
 *   delivered  → email_status: DELIVERED,  event: EMAIL_DELIVERED
 *   failed (permanent) → email_status: FAILED,     event: EMAIL_FAILED
 *   failed (temporary) → status unchanged (Mailgun retries), event: EMAIL_TEMP_FAILED
 *   complained → email_status: COMPLAINED, event: EMAIL_COMPLAINED
 *
 * Returns gracefully if no matching document is found.
 */
async function processEvent(body) {
  const { event, messageId, recipient, severity } = normalisePayload(body) || {};

  if (!event || !messageId) {
    return;
  }

  const HANDLED_EVENTS = ['delivered', 'failed', 'complained'];
  if (!HANDLED_EVENTS.includes(event)) {
    return;
  }

  const document = await documentModel.findByEmailMessageId(messageId);
  if (!document) {
    return;
  }

  if (event === 'delivered') {
    await documentModel.updateEmailStatus(document.id, 'DELIVERED');
    await documentEventModel.create(
      document.id,
      EventType.EMAIL_DELIVERED,
      null, null,
      { to: recipient }
    );
    return;
  }

  if (event === 'complained') {
    await documentModel.updateEmailStatus(document.id, 'COMPLAINED');
    await documentEventModel.create(
      document.id,
      EventType.EMAIL_COMPLAINED,
      null, null,
      { to: recipient }
    );
    return;
  }

  // event === 'failed'
  if (severity === 'temporary') {
    // Mailgun retries temporary failures internally; just log the event, leave email_status as-is.
    await documentEventModel.create(
      document.id,
      EventType.EMAIL_TEMP_FAILED,
      null, null,
      { to: recipient, severity }
    );
  } else {
    // permanent (or unknown severity) — mark as definitively failed
    await documentModel.updateEmailStatus(document.id, 'FAILED');
    await documentEventModel.create(
      document.id,
      EventType.EMAIL_FAILED,
      null, null,
      { to: recipient, severity }
    );
  }
}

module.exports = { processEvent };
