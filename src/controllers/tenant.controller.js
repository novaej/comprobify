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

const getLegalStatus = async (req, res) => {
  const legal = await tenantService.getLegalStatus(req.tenant.id);
  res.json({ ok: true, legal });
};

const acceptLegal = async (req, res) => {
  await tenantService.acceptLegal(req.tenant.id, req.body.termsVersion);
  res.json({ ok: true });
};

module.exports = { getMe, updateLanguage, promote, getLegalStatus, acceptLegal };
