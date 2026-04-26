const AppError = require('./app-error');

class QuotaExceededError extends AppError {
  constructor(message = 'Monthly invoice quota exceeded. Upgrade your plan.') {
    super(message, 402);
    this.code = 'QUOTA_EXCEEDED';
    this.typeSlug = 'quota-exceeded';
    this.title = 'Quota Exceeded';
  }
}

module.exports = QuotaExceededError;
