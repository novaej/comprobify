const tenantService = require('../services/tenant.service');

const updateLanguage = async (req, res) => {
  await tenantService.updateLanguage(req.tenant.id, req.body.language);
  res.json({ ok: true });
};

const promote = async (req, res) => {
  const { apiKeys } = await tenantService.promote(req.tenant.id, req.body.initialSequentials || []);
  res.json({ ok: true, apiKeys });
};

module.exports = { updateLanguage, promote };
