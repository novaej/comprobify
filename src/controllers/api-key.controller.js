const apiKeyService = require('../services/api-key.service');

const list = async (req, res) => {
  const keys = await apiKeyService.listKeys(req.tenant.id);
  res.json({ ok: true, keys });
};

const create = async (req, res) => {
  const { token, scopes } = await apiKeyService.createKey(req.tenant, {
    label: req.body.label,
    environment: req.body.environment,
    scopes: req.body.scopes,
  }, req.apiKey.scopes);
  res.status(201).json({ ok: true, apiKey: token, scopes });
};

const revoke = async (req, res) => {
  await apiKeyService.revokeKey(req.tenant.id, req.params.id, req.apiKey.id);
  res.json({ ok: true });
};

const usage = async (req, res) => {
  const days = req.query.days ? parseInt(req.query.days, 10) : 30;
  const usage = await apiKeyService.getDailyUsage(req.tenant.id, req.params.id, days);
  res.json({ ok: true, usage });
};

module.exports = { list, create, revoke, usage };
