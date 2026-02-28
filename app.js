require('dotenv').config();

const migrate = require('./db/migrate');
const Server = require('./src/server');

migrate()
  .then(() => {
    const server = new Server();
    server.listen();
  })
  .catch((err) => {
    console.error('Startup migration failed:', err.message);
    process.exit(1);
  });
