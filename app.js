require('dotenv').config();

require('./instrument');

const validateConfig = require('./src/config/validate');
const config = require('./src/config');
const migrate = require('./db/migrate');

validateConfig(config);

async function main() {
  await migrate();

  const Server = require('./src/server');
  const server = new Server();
  server.listen();
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
