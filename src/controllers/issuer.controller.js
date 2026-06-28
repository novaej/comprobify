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

/**
 * Like loadOwnedIssuer, but does not filter on active — used by activateIssuer,
 * the one action that must be able to load a deactivated issuer.
 */
async function loadOwnedIssuerAny(req) {
  const id = parseInt(req.params.id, 10);
  const issuer = await issuerModel.findByIdAny(id);
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
  const documentTypes = await issuerService.addDocumentType(issuer.id, req.body.documentType, req.tenant);
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

const uploadLogo = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  if (!req.file) {
    throw new AppError('A logo image file is required', 400, ErrorCodes.INVALID_FILE_UPLOAD);
  }
  const updated = await issuerModel.updateLogo(issuer.id, req.tenant.id, req.file.buffer);
  if (!updated) throw new NotFoundError('Issuer', ErrorCodes.ISSUER_NOT_FOUND);
  res.json({ ok: true });
};

const renewCertificate = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  if (!req.file) {
    throw new AppError('A P12 certificate file is required', 400, ErrorCodes.INVALID_FILE_UPLOAD);
  }
  const { certFingerprint, certExpiry } = await issuerService.renewCertificate(issuer, req.file.buffer, req.body.certPassword);
  res.json({ ok: true, certFingerprint, certExpiry });
};

const updateIssuer = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  const updated = await issuerModel.update(issuer.id, req.tenant.id, {
    tradeName: req.body.tradeName,
    branchAddress: req.body.branchAddress,
  });
  if (!updated) throw new NotFoundError('Issuer', ErrorCodes.ISSUER_NOT_FOUND);
  res.json({
    ok: true,
    issuer: {
      id: updated.id,
      ruc: updated.ruc,
      businessName: updated.business_name,
      tradeName: updated.trade_name || null,
      branchCode: updated.branch_code,
      issuePointCode: updated.issue_point_code,
      branchAddress: updated.branch_address || null,
      certFingerprint: updated.cert_fingerprint || null,
      certExpiry: updated.cert_expiry || null,
    },
  });
};

const removeIssuer = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  await issuerService.removeIssuer(issuer);
  res.json({ ok: true });
};

const getSequentials = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  const sequentials = await issuerService.getSequentials(issuer);
  res.json({ ok: true, sequentials });
};

const setSequential = async (req, res) => {
  const issuer = await loadOwnedIssuer(req);
  await issuerService.setSequential(issuer, req.params.documentType, req.body.environment, req.body.nextSequential);
  res.json({ ok: true });
};

const activateIssuer = async (req, res) => {
  const issuer = await loadOwnedIssuerAny(req);
  await issuerService.activateIssuer(issuer, req.tenant);
  res.json({ ok: true });
};

module.exports = { createBranch, list, getById, listDocumentTypes, addDocumentType, removeDocumentType, uploadLogo, renewCertificate, updateIssuer, removeIssuer, getSequentials, setSequential, activateIssuer };
