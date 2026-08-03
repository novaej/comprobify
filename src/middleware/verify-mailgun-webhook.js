const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const attemptTrackerService = require('../services/attempt-tracker.service');
const AttemptEventTypes = require('../constants/attempt-event-types');

/**
 * Verifies Mailgun's HMAC-SHA256 webhook signature.
 * Supports both v3 (signature object) and legacy (flat body) formats.
 * Rejects with 401 if signature is missing, stale (>300s), or invalid.
 */
function verifyMailgunWebhook(req, res, next) {
  // v3 format: { signature: { timestamp, token, signature } }
  // legacy format: { timestamp, token, signature }
  const sig = req.body && req.body.signature ? req.body.signature : req.body;

  const { timestamp, token, signature } = sig || {};

  if (!timestamp || !token || !signature) {
    return res.status(401).json({ error: 'Missing webhook signature fields' });
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) {
    return res.status(401).json({ error: 'Webhook timestamp too old' });
  }

  const signingKey = config.email.mailgunWebhookSigningKey;
  const computed = crypto
    .createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex');

  const computedBuf = Buffer.from(computed, 'hex');
  const providedBuf = Buffer.from(signature, 'hex');

  if (
    computedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(computedBuf, providedBuf)
  ) {
    // Fire-and-forget — repeated invalid signatures could indicate probing,
    // not just a misconfigured signing key.
    attemptTrackerService.recordEvent(AttemptEventTypes.MAILGUN_WEBHOOK_INVALID_SIGNATURE, ipKeyGenerator(req.ip));
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

module.exports = verifyMailgunWebhook;
