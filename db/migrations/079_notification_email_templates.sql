-- DB-backed, versioned email templates for notifications (Phase C of
-- NEXT_STEPS.md item 13 / ADR-024). Mirrors the `agreements` table's
-- versioned-content pattern: one row per (notification_type, language,
-- version), an is_current flag (newest "activated" row wins), immutable once
-- created — a new version is a new row, never an UPDATE to an existing one.
--
-- Only the 5 email-capable NotificationTypes ever get a row here
-- (PAYMENT_VERIFIED, PAYMENT_REJECTED, SUBSCRIPTION_RENEWAL_DUE,
-- SUBSCRIPTION_EXPIRED, PRICE_CHANGE_ANNOUNCED) — see
-- src/constants/notification-catalog.js's supportsEmail flag. Content is
-- three templates (subject/html/text) rather than three rows, since all
-- three are always published together for one (type, language, version).

BEGIN;

CREATE TABLE notification_email_templates (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  notification_type TEXT          NOT NULL,
  language          TEXT          NOT NULL,
  version           TEXT          NOT NULL,
  subject_template  TEXT          NOT NULL,
  html_template     TEXT          NOT NULL,
  text_template     TEXT          NOT NULL,
  is_current        BOOLEAN       NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_notification_email_templates_type CHECK (
    notification_type IN (
      'PAYMENT_VERIFIED',
      'PAYMENT_REJECTED',
      'SUBSCRIPTION_RENEWAL_DUE',
      'SUBSCRIPTION_EXPIRED',
      'PRICE_CHANGE_ANNOUNCED'
    )
  ),
  CONSTRAINT chk_notification_email_templates_language CHECK (
    language IN ('es', 'en')
  )
);

CREATE INDEX idx_notification_email_templates_type_lang_created
  ON notification_email_templates(notification_type, language, created_at DESC);

-- At most one current row per (notification_type, language) — same shape as
-- agreements' idx_legal_documents_is_current.
CREATE UNIQUE INDEX idx_notification_email_templates_is_current
  ON notification_email_templates(notification_type, language)
  WHERE is_current = true;

COMMIT;
