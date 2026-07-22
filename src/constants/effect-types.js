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
 */
const EffectTypes = Object.freeze({
  SRI_SEND:                                 'SRI_SEND',
  SRI_AUTHORIZE:                            'SRI_AUTHORIZE',
  DOCUMENT_AUTHORIZED_NOTIFICATION:         'DOCUMENT_AUTHORIZED_NOTIFICATION',
  SUBSCRIPTION_ACTIVATE_IF_LINKED:          'SUBSCRIPTION_ACTIVATE_IF_LINKED',
  SUBSCRIPTION_APPLY_TIER_CHANGE_IF_LINKED: 'SUBSCRIPTION_APPLY_TIER_CHANGE_IF_LINKED',
  SUBSCRIPTION_APPLY_RENEWAL_IF_LINKED:     'SUBSCRIPTION_APPLY_RENEWAL_IF_LINKED',
  INVOICE_AUTHORIZED_EMAIL:                 'INVOICE_AUTHORIZED_EMAIL',
  TENANT_AGREEMENT_GENERATE:                'TENANT_AGREEMENT_GENERATE',
  VERIFICATION_EMAIL_SEND:                  'VERIFICATION_EMAIL_SEND',
  WEBHOOK_FANOUT:                           'WEBHOOK_FANOUT',
  PAYMENT_REVIEWED_NOTIFICATION:            'PAYMENT_REVIEWED_NOTIFICATION',
  PAYMENT_REVIEWED_EMAIL:                   'PAYMENT_REVIEWED_EMAIL',
  PAYMENT_PROOF_SUBMITTED_EMAIL:            'PAYMENT_PROOF_SUBMITTED_EMAIL',
  SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION:    'SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION',
  SUBSCRIPTION_RENEWAL_DUE_EMAIL:           'SUBSCRIPTION_RENEWAL_DUE_EMAIL',
  SUBSCRIPTION_EXPIRED_NOTIFICATION:        'SUBSCRIPTION_EXPIRED_NOTIFICATION',
  SUBSCRIPTION_EXPIRED_EMAIL:               'SUBSCRIPTION_EXPIRED_EMAIL',
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
