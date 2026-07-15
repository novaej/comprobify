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
  // RabbitMQ — the async SRI send/authorize pipeline (see ADR-019).
  // sriExchange is a single durable direct exchange; the send/authorize
  // queues bind to it with routing keys 'send'/'authorize' (queue.service.js).
  rabbitmq: {
    url: process.env.RABBITMQ_URL || '',
    sriExchange: process.env.RABBITMQ_SRI_EXCHANGE || 'sri.direct',
  },
  // Thresholds for queue-reconciliation.service.js's two SKIP LOCKED sweeps
  // (POST /v1/admin/jobs/queue-reconciliation). sendStaleMinutes/
  // authorizeStaleMinutes gate re-publishing a document whose dispatch was
  // never confirmed or has gone stale; authorizeCheckDelayMinutes is the
  // minimum time a RECEIVED document must sit before its first
  // authorize-check publish (SRI needs processing time first).
  queueReconciliation: {
    sendStaleMinutes: parseInt(process.env.QUEUE_RECONCILE_SEND_STALE_MINUTES, 10) || 5,
    authorizeCheckDelayMinutes: parseInt(process.env.QUEUE_RECONCILE_AUTHORIZE_DELAY_MINUTES, 10) || 5,
    authorizeStaleMinutes: parseInt(process.env.QUEUE_RECONCILE_AUTHORIZE_STALE_MINUTES, 10) || 5,
    batchLimit: parseInt(process.env.QUEUE_RECONCILE_BATCH_LIMIT, 10) || 100,
  },
  email: {
    provider:                 process.env.EMAIL_PROVIDER                 || 'mailgun',
    from:                     process.env.EMAIL_FROM                     || '',
    // Optional override for invoice/document emails only — falls back to
    // EMAIL_FROM when unset, so existing deployments need no change.
    fromDocuments:            process.env.EMAIL_FROM_DOCUMENTS           || process.env.EMAIL_FROM || '',
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
  // the SPI transfer — display text only, not a secret. Validated as
  // required at startup (src/config/validate.js) — without these, a tenant
  // creating a subscription gets an empty bank-transfer block with no way
  // to actually pay.
  bankTransfer: {
    bankName:       process.env.BANK_TRANSFER_BANK_NAME       || '',
    accountType:    process.env.BANK_TRANSFER_ACCOUNT_TYPE    || '',
    accountNumber:  process.env.BANK_TRANSFER_ACCOUNT_NUMBER  || '',
    accountHolder:  process.env.BANK_TRANSFER_ACCOUNT_HOLDER  || '',
    identification: process.env.BANK_TRANSFER_IDENTIFICATION  || '',
  },
  // Where the operator gets notified that a tenant uploaded payment proof and
  // needs review. Validated as required at startup — this was originally
  // optional (mirroring the SENTRY_DSN pattern) on the reasoning that it's
  // an operational convenience, not tenant-facing behavior. Reclassified as
  // required: without it, proof submissions land with zero notification to
  // anyone, discoverable only by manually polling the admin payments list —
  // too easy to silently miss for something that gates real revenue.
  adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL || '',

  // Operator identity — substituted into legal document templates at publish
  // time ({{operador.nombre}}, {{operador.ruc}}, {{operador.email}}).
  // Required before calling POST /v1/admin/agreements; not needed for
  // any other API path so not validated at startup.
  operator: {
    nombre:   process.env.OPERATOR_NAME    || '',
    ruc:      process.env.OPERATOR_RUC     || '',
    email:    process.env.OPERATOR_EMAIL   || '',
    domicilio: process.env.OPERATOR_ADDRESS || 'Domicilio disponible previa solicitud razonable',
  },

  // Ecuador's current IVA (VAT) rate, applied to subscription pricing
  // (src/constants/subscription-tiers.js re-exports this as IVA_RATE for its
  // existing consumers). Kept as an env var rather than hardcoded because
  // Ecuador has changed this rate more than once — a rate change should be a
  // config update + restart, not a code change + redeploy. Defaults to the
  // rate in effect as of this writing (15%); override with IVA_RATE if it
  // changes (e.g. IVA_RATE=0.05 for 5%).
  ivaRate: process.env.IVA_RATE !== undefined ? parseFloat(process.env.IVA_RATE) : 0.15,
};

module.exports = config;
