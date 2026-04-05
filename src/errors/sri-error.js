const AppError = require('./app-error');

class SriError extends AppError {
  constructor(message, messages = []) {
    super(message, 502);
    this.sriMessages = messages;
    this.code = 'SRI_SUBMISSION_FAILED';
    this.typeSlug = 'sri-error';
    this.title = 'SRI Submission Failed';
  }
}

module.exports = SriError;
