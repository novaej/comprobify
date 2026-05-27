const AppError = require('./app-error');

class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = null) {
    super(`${resource} not found`, 404, code);
  }
}

module.exports = NotFoundError;
