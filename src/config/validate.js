/**
 * Config validation — runs at startup to catch misconfiguration early.
 *
 * Split in two: validateCoreConfig() covers vars every comprobify process
 * needs — the API and workers/sri-worker.js alike. RabbitMQ connectivity is
 * shared (the API publishes, the worker consumes), and the ability to
 * actually send mail is shared too, since the worker is what sends the
 * invoice-authorized email once a document is authorized. validateConfig()
 * combines the same core checks with everything only the API's own
 * routes/services touch (admin auth, certificate encryption, billing,
 * inbound webhook verification) — code paths the worker's message handlers
 * never reach, so it has no reason to require their config. Both collect
 * into one shared list (collectCoreMissing) rather than validateConfig
 * calling validateCoreConfig and letting it throw independently — otherwise
 * a config missing vars from both categories would only ever report the
 * core ones, since validateCoreConfig's own throw would fire first and the
 * rest of validateConfig would never run.
 *
 * Philosophy: Collect all missing vars into one error message so the operator
 * fixes everything in one restart, not one-at-a-time.
 */

function collectCoreMissing(cfg) {
  const missing = [];

  if (!['staging', 'production'].includes(cfg.appEnv)) {
    throw new Error('APP_ENV must be "staging" or "production"');
  }

  // The document send/authorize pipeline is fully async (see ADR-019) —
  // there is no synchronous fallback. The API needs this to publish, and
  // workers/sri-worker.js needs it to consume; without it on either side,
  // a document flips to PENDING_SEND but nothing ever dispatches it to SRI.
  if (!cfg.rabbitmq.url) {
    missing.push('RABBITMQ_URL');
  }

  // Required to actually send mail when email is enabled (default provider
  // is 'mailgun', opt out via EMAIL_PROVIDER=none). workers/sri-worker.js
  // sends the invoice-authorized email itself on authorization, so it needs
  // these same vars. MAILGUN_WEBHOOK_SIGNING_KEY is deliberately NOT here —
  // verifying an inbound delivery webhook is an API-only route the worker
  // never touches, so it's checked in validateConfig() below instead.
  if (cfg.email.provider && cfg.email.provider !== 'none') {
    if (!cfg.email.mailgunApiKey) {
      missing.push('MAILGUN_API_KEY');
    }
    if (!cfg.email.mailgunDomain) {
      missing.push('MAILGUN_DOMAIN');
    }
    if (!cfg.email.from) {
      missing.push('EMAIL_FROM');
    }
  }

  return missing;
}

function validateCoreConfig(cfg) {
  const missing = collectCoreMissing(cfg);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}

function validateConfig(cfg) {
  const missing = collectCoreMissing(cfg);

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

  // Required when email is enabled — see collectCoreMissing() for why this
  // one lives here instead of there.
  if (cfg.email.provider && cfg.email.provider !== 'none') {
    if (!cfg.email.mailgunWebhookSigningKey) {
      missing.push('MAILGUN_WEBHOOK_SIGNING_KEY');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}

module.exports = { validateConfig, validateCoreConfig };
