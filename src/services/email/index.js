const config = require('../../config');

function getProvider() {
  if (config.email.provider === 'mailgun') return require('./providers/mailgun.provider');
  throw new Error(`Unknown email provider: ${config.email.provider}`);
}

module.exports = { getProvider };
