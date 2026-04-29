const adminService = require('../services/admin.service');
const issuerService = require('../services/issuer.service');
const AppError = require('../errors/app-error');

const promote = async (req, res) => {
  if (req.tenant.status !== 'ACTIVE') {
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

module.exports = { promote, listDocumentTypes, addDocumentType, removeDocumentType };
