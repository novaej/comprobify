const apiKeyService = require('../services/api-key.service');

const list = async (req, res) => {
  const keys = await apiKeyService.listKeys(req.tenant.id);
  res.json({ ok: true, keys });
};

const create = async (req, res) => {
  const apiKey = await apiKeyService.createKey(req.tenant, {
    label: req.body.label,
    environment: req.body.environment,
  });
  res.status(201).json({ ok: true, apiKey });
};

const revoke = async (req, res) => {
  await apiKeyService.revokeKey(req.tenant.id, req.params.id, req.apiKey.id);
  res.json({ ok: true });
};

module.exports = { list, create, revoke };
