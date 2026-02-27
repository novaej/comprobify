const express = require('express');
const cors = require('cors');
const config = require('./config');
const errorHandler = require('./middleware/error-handler');

class Server {
  constructor() {
    this.app = express();
    this.port = config.port;

    this.middlewares();
    this.routes();
    this.errorHandling();
  }

  middlewares() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  routes() {
    this.app.use('/api', require('./routes'));
  }

  errorHandling() {
    this.app.use(errorHandler);
  }

  listen() {
    this.app.listen(this.port, () => {
      console.log(`Server running on port ${this.port}`);
    });
  }
}

module.exports = Server;
