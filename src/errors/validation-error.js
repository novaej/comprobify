const AppError = require('./app-error');

class ValidationError extends AppError {
  constructor(errors = []) {
    super('Validation failed', 400);
    this.errors = errors;
  }
}

module.exports = ValidationError;
