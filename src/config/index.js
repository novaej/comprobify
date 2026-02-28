const config = {
  port: process.env.PORT || 8080,
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'sri_invoicing',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  },
  sri: {
    testBaseUrl: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws',
    // prodBaseUrl: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
    prodBaseUrl: '',
  },
};

module.exports = config;
