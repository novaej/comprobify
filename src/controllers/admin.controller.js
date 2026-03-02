const adminService = require('../services/admin.service');

const createIssuer = async (req, res) => {
  const { issuer, apiKey } = await adminService.createIssuer(
    req.body,
    req.file?.buffer,
    req.body.certPassword,
    req.body.sourceIssuerId ? parseInt(req.body.sourceIssuerId, 10) : undefined,
  );
  res.status(201).json({ ok: true, issuer, apiKey });
};

const listIssuers = async (req, res) => {
  const issuers = await adminService.listIssuers();
  res.json({ ok: true, issuers });
};

const createApiKey = async (req, res) => {
  const issuerId = parseInt(req.params.id, 10);
  const apiKey = await adminService.createApiKey(issuerId, req.body.label);
  res.status(201).json({ ok: true, apiKey });
};

const revokeApiKey = async (req, res) => {
  await adminService.revokeApiKey(parseInt(req.params.id, 10));
  res.json({ ok: true });
};

module.exports = { createIssuer, listIssuers, createApiKey, revokeApiKey };
