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
  if (!cfg.encryptionKey) {
    missing.push('ENCRYPTION_KEY');
  } else if (cfg.encryptionKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  if (!cfg.adminSecret) {
    missing.push('ADMIN_SECRET');
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
