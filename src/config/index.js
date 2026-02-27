const config = {
  port: process.env.PORT || 8080,
  environment: process.env.ENVIRONMENT || '1',
  ruc: process.env.RUC || '',
  branchCode: process.env.ESTABLECIMIENTO || '001',
  issuePointCode: process.env.PUNTO_EMISION || '001',
  certPassword: process.env.DIGITAL_SIGNTURE_PASSWORD || '',
  certPath: process.env.CERT_PATH || 'cert/token.p12',
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
    prodBaseUrl: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
  },
};

config.sri.baseUrl =
  config.environment === '2' ? config.sri.prodBaseUrl : config.sri.testBaseUrl;
config.sri.receptionUrl = `${config.sri.baseUrl}/RecepcionComprobantesOffline?wsdl`;
config.sri.authorizationUrl = `${config.sri.baseUrl}/AutorizacionComprobantesOffline?wsdl`;

module.exports = config;
