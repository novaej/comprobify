-- Phase 2 of the RabbitMQ async worker (NEXT_STEPS.md item 2, ADR-022).
-- Generalizes Phase 1's per-document dispatch tracking (send_dispatch_attempted_at/
-- authorize_dispatch_attempted_at + two hand-written reconciliation queries) into
-- one generic outbox table used by ALL 17 async side effects, SRI send/authorize
-- included. See ADR-022 for the full design; ADR-019 stays as the historical
-- record of why async SRI submission exists, since only the dispatch-tracking
-- mechanics move here.
--
-- status lifecycle: PENDING -> DISPATCHED -> DONE, or -> FAILED once
-- attempt_count exceeds config.pendingEffects.maxAttempts. SRI_AUTHORIZE is the
-- one effect type whose handler can also leave a row exactly as-is (a "still
-- processing, check again later" outcome — see pending-effect.service.js's
-- process()) rather than ever reaching DONE/FAILED on a given attempt.
--
-- Never hard-deleted (CLAUDE.md rule #7) — DONE/FAILED rows are the audit trail,
-- same reasoning as payment_proofs. Not tenant/issuer-scoped, no RLS — same
-- precedent as notifications/tenant_events/webhook_deliveries (db.query() only).

BEGIN;

CREATE TABLE pending_effects (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  effect_type            TEXT          NOT NULL,
  payload                JSONB         NOT NULL,
  dedup_key              TEXT,
  status                 TEXT          NOT NULL DEFAULT 'PENDING',
  dispatch_attempted_at  TIMESTAMPTZ,
  processed_at           TIMESTAMPTZ,
  attempt_count          INT           NOT NULL DEFAULT 0,
  last_error             TEXT,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_pending_effects_status CHECK (status IN ('PENDING', 'DISPATCHED', 'DONE', 'FAILED')),
  CONSTRAINT chk_pending_effects_type CHECK (
    effect_type IN (
      'SRI_SEND',
      'SRI_AUTHORIZE',
      'DOCUMENT_AUTHORIZED_NOTIFICATION',
      'SUBSCRIPTION_ACTIVATE_IF_LINKED',
      'SUBSCRIPTION_APPLY_TIER_CHANGE_IF_LINKED',
      'SUBSCRIPTION_APPLY_RENEWAL_IF_LINKED',
      'INVOICE_AUTHORIZED_EMAIL',
      'TENANT_AGREEMENT_GENERATE',
      'VERIFICATION_EMAIL_SEND',
      'WEBHOOK_FANOUT',
      'PAYMENT_REVIEWED_NOTIFICATION',
      'PAYMENT_REVIEWED_EMAIL',
      'PAYMENT_PROOF_SUBMITTED_EMAIL',
      'SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION',
      'SUBSCRIPTION_RENEWAL_DUE_EMAIL',
      'SUBSCRIPTION_EXPIRED_NOTIFICATION',
      'SUBSCRIPTION_EXPIRED_EMAIL'
    )
  )
);

-- Drives the reconciliation sweep: find PENDING/DISPATCHED rows whose dispatch
-- was never confirmed or has gone stale. effect_type is in the index because
-- reconcilePendingEffects() branches SRI_AUTHORIZE's staleness window
-- (authorizeCheckDelayMinutes/authorizeStaleMinutes) from everything else's
-- (effectStaleMinutes) — see queue-reconciliation.service.js.
CREATE INDEX idx_pending_effects_reconcile ON pending_effects (effect_type, status, dispatch_attempted_at)
  WHERE status IN ('PENDING', 'DISPATCHED');

-- Only SRI_AUTHORIZE populates dedup_key (format 'sri-authorize:<documentId>'),
-- so GET /:key/authorize can find-or-create the existing open row for a
-- document instead of ever creating a duplicate — see
-- document-transmission.service.js's queueAuthorizationCheck.
CREATE UNIQUE INDEX idx_pending_effects_dedup ON pending_effects (dedup_key)
  WHERE dedup_key IS NOT NULL AND status IN ('PENDING', 'DISPATCHED');

-- Retire the Phase-1-only columns pending_effects replaces. Both schemas per
-- CLAUDE.md Common Mistake #14.
ALTER TABLE documents         DROP COLUMN send_dispatch_attempted_at, DROP COLUMN authorize_dispatch_attempted_at;
ALTER TABLE sandbox.documents DROP COLUMN send_dispatch_attempted_at, DROP COLUMN authorize_dispatch_attempted_at;

COMMIT;
