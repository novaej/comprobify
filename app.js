require('dotenv').config();

const validateConfig = require('./src/config/validate');
const config = require('./src/config');

validateConfig(config);

const Server = require('./src/server');

const server = new Server();
server.listen();
