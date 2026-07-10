/**
 * Config validation — runs at startup to catch misconfiguration early.
 *
 * Validates that all required environment variables are set. If any are missing
 * or malformed, throws immediately before Express accepts any requests.
 *
 * Philosophy: Collect all missing vars into one error message so the operator
 * fixes everything in one restart, not one-at-a-time.
 */

function validateConfig(cfg) {
  const missing = [];

  // Always required
  if (!['staging', 'production'].includes(cfg.appEnv)) {
    throw new Error('APP_ENV must be "staging" or "production"');
  }

  if (!cfg.encryptionKey) {
    missing.push('ENCRYPTION_KEY');
  } else if (cfg.encryptionKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  if (!cfg.adminSecret) {
    missing.push('ADMIN_SECRET');
  }

  if (!cfg.appBaseUrl) {
    missing.push('APP_BASE_URL');
  }

  // Without these, POST /v1/subscriptions succeeds but hands the tenant an
  // empty bank-transfer block with no way to actually pay — silent breakage
  // of the entire billing pipeline, not something that fails loudly on its own.
  if (!cfg.bankTransfer.bankName) {
    missing.push('BANK_TRANSFER_BANK_NAME');
  }
  if (!cfg.bankTransfer.accountType) {
    missing.push('BANK_TRANSFER_ACCOUNT_TYPE');
  }
  if (!cfg.bankTransfer.accountNumber) {
    missing.push('BANK_TRANSFER_ACCOUNT_NUMBER');
  }
  if (!cfg.bankTransfer.accountHolder) {
    missing.push('BANK_TRANSFER_ACCOUNT_HOLDER');
  }
  if (!cfg.bankTransfer.identification) {
    missing.push('BANK_TRANSFER_IDENTIFICATION');
  }

  // Without this, a payment proof submission fires no notification to
  // anyone — the only way to notice is manually polling the admin payments
  // list. Too easy to silently miss for something that gates real revenue.
  if (!cfg.adminNotificationEmail) {
    missing.push('ADMIN_NOTIFICATION_EMAIL');
  }

  // Required when email is enabled (default provider is 'mailgun', opt out by setting EMAIL_PROVIDER=none)
  if (cfg.email.provider && cfg.email.provider !== 'none') {
    if (!cfg.email.mailgunApiKey) {
      missing.push('MAILGUN_API_KEY');
    }
    if (!cfg.email.mailgunDomain) {
      missing.push('MAILGUN_DOMAIN');
    }
    if (!cfg.email.mailgunWebhookSigningKey) {
      missing.push('MAILGUN_WEBHOOK_SIGNING_KEY');
    }
    if (!cfg.email.from) {
      missing.push('EMAIL_FROM');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}

module.exports = validateConfig;
