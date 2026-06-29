const tenantService = require('../services/tenant.service');

const getMe = async (req, res) => {
  res.json({ ok: true, tenant: req.tenant });
};

const updateLanguage = async (req, res) => {
  await tenantService.updateLanguage(req.tenant.id, req.body.language);
  res.json({ ok: true });
};

const promote = async (req, res) => {
  const result = await tenantService.promote(
    req.tenant.id,
    req.body.initialSequentials || [],
    req.body.tier,
    req.body.billingInterval,
  );
  res.json({ ok: true, ...result });
};

module.exports = { getMe, updateLanguage, promote };
