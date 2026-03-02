const config = {
  port: process.env.PORT || 8080,
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  adminSecret: process.env.ADMIN_SECRET || '',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'sri_invoicing',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  },
  sri: {
    testBaseUrl: process.env.SRI_TEST_BASE_URL || 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws',
    prodBaseUrl: process.env.SRI_PROD_BASE_URL || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
  },
  email: {
    provider:      process.env.EMAIL_PROVIDER    || 'mailgun',
    from:          process.env.EMAIL_FROM        || '',
    mailgunApiKey: process.env.MAILGUN_API_KEY   || '',
    mailgunDomain: process.env.MAILGUN_DOMAIN    || '',
  },
};

module.exports = config;
