const adminService = require('../services/admin.service');
const issuerService = require('../services/issuer.service');
const AppError = require('../errors/app-error');
const TenantStatus = require('../constants/tenant-status');

const createBranch = async (req, res) => {
  const { issuer, apiKey } = await issuerService.createBranch(
    req.tenant,
    req.issuer,
    req.body,
    req.file?.buffer || null,
    req.body.certPassword || null,
  );
  res.status(201).json({ ok: true, issuer, apiKey });
};

const promote = async (req, res) => {
  if (req.tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError('Email verification required before promoting to production. Check your inbox.', 403);
  }
  const { issuer, apiKey } = await adminService.promoteIssuer(
    req.issuer.id,
    req.body.initialSequentials || [],
  );
  res.json({ ok: true, issuer, apiKey });
};

const listDocumentTypes = async (req, res) => {
  const documentTypes = await issuerService.listDocumentTypes(req.issuer.id);
  res.json({ ok: true, documentTypes });
};

const addDocumentType = async (req, res) => {
  const documentTypes = await issuerService.addDocumentType(req.issuer.id, req.body.documentType);
  res.json({ ok: true, documentTypes });
};

const removeDocumentType = async (req, res) => {
  const documentTypes = await issuerService.removeDocumentType(req.issuer.id, req.params.code);
  res.json({ ok: true, documentTypes });
};

const me = async (req, res) => {
  const i = req.issuer;
  res.json({
    ok: true,
    issuer: {
      ruc: i.ruc,
      businessName: i.business_name,
      tradeName: i.trade_name || null,
      branchCode: i.branch_code,
      issuePointCode: i.issue_point_code,
      sandbox: i.sandbox,
      certFingerprint: i.cert_fingerprint || null,
      certExpiry: i.cert_expiry || null,
    },
  });
};

const list = async (req, res) => {
  const issuers = await issuerService.listIssuers(req.tenant.id);
  res.json({ ok: true, issuers });
};

module.exports = { createBranch, promote, list, listDocumentTypes, addDocumentType, removeDocumentType, me };
