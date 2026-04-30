const tenantModel = require('../models/tenant.model');

async function updateLanguage(tenantId, language) {
  await tenantModel.updatePreferredLanguage(tenantId, language);
}

module.exports = { updateLanguage };
