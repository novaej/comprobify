const AppError = require('./app-error');

class SriError extends AppError {
  constructor(message, messages = []) {
    super(message, 502);
    this.sriMessages = messages;
  }
}

module.exports = SriError;
