/**
 * Stable machine-readable effect_type codes for the pending_effects outbox
 * (see ADR-022, CLAUDE.md's "Async worker: pending_effects outbox" entry).
 *
 * Two behavioral buckets:
 *   - One-shot dispatch guarantee (everything except SRI_AUTHORIZE) — handler
 *     runs once, resolves, effect marked DONE.
 *   - SRI_AUTHORIZE — polling. The handler can resolve with { requeue: true }
 *     when SRI reports "still processing," leaving the row exactly as-is so
 *     reconciliation re-dispatches it later instead of marking it DONE/FAILED.
 *
 * Adding a new type requires updating the chk_pending_effects_type CHECK
 * constraint in a migration (mirrors CLAUDE.md Common Mistake #12/#19) and
 * registering a handler in src/effects/index.js.
 *
 * NOTIFICATION_DISPATCH (ADR-024) is a single
 * channel-neutral effect replacing what used to be 8 separate
 * type-specific `*_NOTIFICATION`/`*_EMAIL` types (DOCUMENT_AUTHORIZED_NOTIFICATION,
 * PAYMENT_REVIEWED_NOTIFICATION/_EMAIL, SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION/_EMAIL,
 * SUBSCRIPTION_EXPIRED_NOTIFICATION/_EMAIL, PRICE_CHANGE_EMAIL — migration 078
 * drops all 8 from the DB CHECK constraint too, safe since no production data
 * existed yet). Every notification's in-app row is now created synchronously
 * by notificationService (no queued "_NOTIFICATION" effect needed at all);
 * NOTIFICATION_DISPATCH is enqueued only when a type supports the EMAIL
 * channel, and is named for what it's for — whatever async channel work a
 * notification still needs — not for a specific channel, so a future
 * channel doesn't require inventing another effect type.
 */
// SUBSCRIPTION_ACTIVATE_IF_LINKED / _APPLY_TIER_CHANGE_IF_LINKED /
// _APPLY_RENEWAL_IF_LINKED deliberately do NOT exist here. They were
// originally planned to fire on every document authorization system-wide
// (checking internally whether the document happened to be a
// subscription-funding invoice) but were cut before shipping: linkInvoice()
// already activates immediately when the linked invoice is already
// AUTHORIZED (the normal case), and the rare reverse ordering — linking a
// not-yet-authorized invoice — is instead caught by a periodic scan in
// POST /v1/admin/jobs/subscriptions, not a RabbitMQ message fired for every
// tenant's every invoice. See ADR-022's addendum.
const EffectTypes = Object.freeze({
  SRI_SEND:                      'SRI_SEND',
  SRI_AUTHORIZE:                 'SRI_AUTHORIZE',
  INVOICE_AUTHORIZED_EMAIL:      'INVOICE_AUTHORIZED_EMAIL',
  TENANT_AGREEMENT_GENERATE:     'TENANT_AGREEMENT_GENERATE',
  VERIFICATION_EMAIL_SEND:       'VERIFICATION_EMAIL_SEND',
  WEBHOOK_FANOUT:                'WEBHOOK_FANOUT',
  PAYMENT_PROOF_SUBMITTED_EMAIL: 'PAYMENT_PROOF_SUBMITTED_EMAIL',
  NOTIFICATION_DISPATCH:         'NOTIFICATION_DISPATCH',
});

// Routing key each effect_type publishes under — three queues, not one, so a
// burst of slow side effects (e.g. WEBHOOK_FANOUT hitting a sluggish
// third-party endpoint) can never starve the RabbitMQ prefetch window SRI
// submission depends on. See queue.service.js and workers/worker.js.
const ROUTING_KEY_BY_EFFECT_TYPE = Object.freeze({
  [EffectTypes.SRI_SEND]:      'send',
  [EffectTypes.SRI_AUTHORIZE]: 'authorize',
});
const DEFAULT_ROUTING_KEY = 'effects';

function routingKeyForEffectType(effectType) {
  return ROUTING_KEY_BY_EFFECT_TYPE[effectType] || DEFAULT_ROUTING_KEY;
}

module.exports = { EffectTypes, routingKeyForEffectType };
