-- Phase B of NEXT_STEPS item 13 (ADR-024): unified notify() + effect
-- consolidation.
--
-- notifications.email_status tracks per-row email delivery outcome for
-- types that support the EMAIL channel (notification-catalog.js) — NULL for
-- types that never do (DOCUMENT_AUTHORIZED, CERT_EXPIRING/EXPIRED). Set to
-- PENDING the moment notificationService.dispatchNotification() enqueues the
-- NOTIFICATION_DISPATCH effect, then SENT/FAILED/SKIPPED by that effect's
-- handler — mirrors the existing documents.email_status pattern.
ALTER TABLE notifications ADD COLUMN email_status TEXT;

ALTER TABLE notifications
  ADD CONSTRAINT chk_notifications_email_status
    CHECK (email_status IS NULL OR email_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'));

-- pending_effects: 8 type-specific NOTIFICATION/EMAIL effect types collapse
-- into one channel-neutral NOTIFICATION_DISPATCH (the in-app half of each
-- pair is now created synchronously by notificationService, not queued at
-- all — see notification.service.js's dispatchNotification()). Confirmed no
-- production data exists yet, so the CHECK constraint is simply replaced
-- with the new minimal list rather than needing to stay append-only.
ALTER TABLE pending_effects
  DROP CONSTRAINT chk_pending_effects_type,
  ADD CONSTRAINT chk_pending_effects_type
    CHECK (
      effect_type IN (
        'SRI_SEND',
        'SRI_AUTHORIZE',
        'INVOICE_AUTHORIZED_EMAIL',
        'TENANT_AGREEMENT_GENERATE',
        'VERIFICATION_EMAIL_SEND',
        'WEBHOOK_FANOUT',
        'PAYMENT_PROOF_SUBMITTED_EMAIL',
        'NOTIFICATION_DISPATCH'
      )
    );
