const config = {
  port: process.env.PORT || 8080,
  appEnv: process.env.APP_ENV || 'staging',
  appBaseUrl: process.env.APP_BASE_URL || '',
  docsBaseUrl: process.env.DOCS_BASE_URL || '',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  adminSecret: process.env.ADMIN_SECRET || '',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'comprobify_local',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  },
  sri: {
    testBaseUrl: process.env.SRI_TEST_BASE_URL || 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws',
    prodBaseUrl: process.env.SRI_PROD_BASE_URL || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
  },
  email: {
    provider:                 process.env.EMAIL_PROVIDER                 || 'mailgun',
    from:                     process.env.EMAIL_FROM                     || '',
    mailgunApiKey:            process.env.MAILGUN_API_KEY                || '',
    mailgunDomain:            process.env.MAILGUN_DOMAIN                 || '',
    mailgunWebhookSigningKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY    || '',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60,
  },
  verificationTokenTtlHours: parseInt(process.env.VERIFICATION_TOKEN_TTL_HOURS, 10) || 24,
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
  },
  // Returned in createSubscription's response so a tenant knows where to send
  // the SPI transfer — display text only, not a secret.
  bankTransfer: {
    bankName:       process.env.BANK_TRANSFER_BANK_NAME       || '',
    accountType:    process.env.BANK_TRANSFER_ACCOUNT_TYPE    || '',
    accountNumber:  process.env.BANK_TRANSFER_ACCOUNT_NUMBER  || '',
    accountHolder:  process.env.BANK_TRANSFER_ACCOUNT_HOLDER  || '',
    identification: process.env.BANK_TRANSFER_IDENTIFICATION  || '',
  },
  // Where the operator gets notified that a tenant uploaded payment proof and
  // needs review. Optional — unset means that notification email is skipped
  // (mirrors the SENTRY_DSN optional pattern), since it's an operational
  // convenience, not something tenant-facing behavior depends on.
  adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL || '',
};

module.exports = config;
