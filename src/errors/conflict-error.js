const AppError = require('./app-error');

class ConflictError extends AppError {
  constructor(message = 'Conflict', code = null) {
    super(message, 409, code);
  }
}

module.exports = ConflictError;
