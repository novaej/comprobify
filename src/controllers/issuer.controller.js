const issuerService = require('../services/issuer.service');
const issuerModel = require('../models/issuer.model');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const TenantStatus = require('../constants/tenant-status');
const ErrorCodes = require('../constants/error-codes');

/**
 * Fetches the issuer identified by req.params.id and confirms it belongs to the
 * authenticated tenant. Returns the full issuer row.
 */
async function loadOwnedIssuer(req) {
  const id = parseInt(req.params.id, 10);
  const issuer = await issuerModel.findById(id);
  if (!issuer) {
    throw new NotFoundError('Issuer', ErrorCodes.ISSUER_NOT_FOUND);
  }
  if (issuer.tenant_id !== req.tenant.id) {
    throw new AppError('Issuer does not belong to this tenant', 403, ErrorCodes.ISSUER_FORBIDDEN);
  }
  return issuer;
}

const createBranch = async (req, res) => {
  if (req.tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError(
      'Email verification is required before creating additional branches. Check your inbox.',
      403,
      ErrorCodes.EMAIL_VERIFICATION_REQUIRED
    );
  }

  let sourceIssuer = null;
  if (!req.file) {
    const sourceId = req.body.sourceIssuerId ? parseInt(req.body.sourceIssuerId, 10) : null;
    if (sourceId) {
      sourceIssuer = await issuerModel.findById(sourceId);
      if (!sourceIssuer || sourceIssuer.tenant_id !== req.tenant.id) {
        throw new NotFoundError('sourceIssuerId', ErrorCodes.SOURCE_ISSUER_NOT_FOUND);
      }
    } else {
      const issuers = await issuerModel.findAllByTenantId(req.tenant.id);
      sourceIssuer = issuers[0] || null;
      if (!sourceIssuer) {
        throw new AppError(
          'No existing issuer found to inherit the certificate from. Upload a P12 file or pass sourceIssuerId.',
          400
        );
      }
    }
  }

  const { issuer } = await issuerService.createBranch(
    req.tenant,
    sourceIssuer,
    req.body,
    req.file?.buffer || null,
    req.body.certPassword || null,
  );
  res.status(201).json({ ok: true, issuer });
};

const listDocumentTypes = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  const documentTypes = await issuerService.listDocumentTypes(issuer.id);
  res.json({ ok: true, documentTypes });
};

const addDocumentType = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  const documentTypes = await issuerService.addDocumentType(issuer.id, req.body.documentType);
  res.json({ ok: true, documentTypes });
};

const removeDocumentType = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  const documentTypes = await issuerService.removeDocumentType(issuer.id, req.params.code);
  res.json({ ok: true, documentTypes });
};

const getById = async (req, res) => {
  const i = await loadOwnedIssuer(req);
  res.json({
    ok: true,
    issuer: {
      id: i.id,
      ruc: i.ruc,
      businessName: i.business_name,
      tradeName: i.trade_name || null,
      branchCode: i.branch_code,
      issuePointCode: i.issue_point_code,
      branchAddress: i.branch_address || null,
      certFingerprint: i.cert_fingerprint || null,
      certExpiry: i.cert_expiry || null,
    },
  });
};

const list = async (req, res) => {
  const issuers = await issuerService.listIssuers(req.tenant.id);
  res.json({ ok: true, issuers });
};

module.exports = { createBranch, list, getById, listDocumentTypes, addDocumentType, removeDocumentType };
