const tenantService = require('../services/tenant.service');

const updateLanguage = async (req, res) => {
  await tenantService.updateLanguage(req.tenant.id, req.body.language);
  res.json({ ok: true });
};

module.exports = { updateLanguage };
