const AppError = require('./app-error');

class ValidationError extends AppError {
  constructor(errors = []) {
    super('Validation failed', 400);
    this.errors = errors;
    this.code = 'VALIDATION_FAILED';
    this.typeSlug = 'validation-error';
    this.title = 'Validation Failed';
  }
}

module.exports = ValidationError;
