const adminService = require('../services/admin.service');

// Tenants
const createTenant = async (req, res) => {
  const tenant = await adminService.createTenant(req.body);
  res.status(201).json({ ok: true, tenant });
};

const listTenants = async (req, res) => {
  const tenants = await adminService.listTenants();
  res.json({ ok: true, tenants });
};

const updateTenantTier = async (req, res) => {
  const tenant = await adminService.updateTenantTier(parseInt(req.params.id, 10), req.body.subscriptionTier);
  res.json({ ok: true, tenant });
};

const updateTenantStatus = async (req, res) => {
  const tenant = await adminService.updateTenantStatus(parseInt(req.params.id, 10), req.body.status);
  res.json({ ok: true, tenant });
};

const verifyTenant = async (req, res) => {
  const tenant = await adminService.verifyTenant(parseInt(req.params.id, 10));
  res.json({ ok: true, tenant });
};

// Issuers
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

const promoteIssuer = async (req, res) => {
  const { issuer, apiKey } = await adminService.promoteIssuer(
    parseInt(req.params.id, 10),
    req.body.initialSequentials || [],
  );
  res.json({ ok: true, issuer, apiKey });
};

// API keys
const createApiKey = async (req, res) => {
  const issuerId = parseInt(req.params.id, 10);
  const apiKey = await adminService.createApiKey(issuerId, req.body.label, req.body.revokeExisting === true);
  res.status(201).json({ ok: true, apiKey });
};

const revokeApiKey = async (req, res) => {
  await adminService.revokeApiKey(parseInt(req.params.id, 10));
  res.json({ ok: true });
};

module.exports = {
  createTenant, listTenants, updateTenantTier, updateTenantStatus, verifyTenant,
  createIssuer, listIssuers, promoteIssuer, createApiKey, revokeApiKey,
};
