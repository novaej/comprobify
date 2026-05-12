const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const issuerModel = require('../models/issuer.model');
const tenantModel = require('../models/tenant.model');
const sequentialService = require('./sequential.service');
const cryptoService = require('./crypto.service');
const certificateService = require('./certificate.service');
const { SUPPORTED_TYPES } = require('../builders');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const TIERS = require('../constants/subscription-tiers');

async function listDocumentTypes(issuerId) {
  return issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
}

async function addDocumentType(issuerId, documentType) {
  if (!SUPPORTED_TYPES.includes(documentType)) {
    throw new AppError(`Document type '${documentType}' is not supported. Supported types: ${SUPPORTED_TYPES.join(', ')}`, 400);
  }
  await issuerDocumentTypeModel.activate(issuerId, documentType);
  return issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
}

async function removeDocumentType(issuerId, documentType) {
  const active = await issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
  if (!active.includes(documentType)) {
    throw new AppError(`Document type '${documentType}' is not active for this issuer`, 404);
  }
  if (active.length <= 1) {
    throw new AppError('Cannot remove the last document type — at least one must remain active', 400);
  }
  await issuerDocumentTypeModel.deactivate(issuerId, documentType);
  return issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
}

async function createBranch(tenant, sourceIssuer, fields, p12Buffer, p12Password) {
  const tierConfig = TIERS[tenant.subscriptionTier];

  const issuePointCount = await tenantModel.countIssuePointsByBranch(tenant.id, fields.branchCode);
  if (issuePointCount === 0) {
    if (tierConfig.maxBranches !== null) {
      const branchCount = await tenantModel.countBranchesByTenantId(tenant.id);
      if (branchCount >= tierConfig.maxBranches) {
        throw new AppError(
          `You have reached the branch limit for the ${tenant.subscriptionTier} plan (${tierConfig.maxBranches})`,
          402
        );
      }
    }
  } else if (tierConfig.maxIssuePointsPerBranch !== null) {
    if (issuePointCount >= tierConfig.maxIssuePointsPerBranch) {
      throw new AppError(
        `Branch ${fields.branchCode} has reached the issue point limit for the ${tenant.subscriptionTier} plan (${tierConfig.maxIssuePointsPerBranch})`,
        402
      );
    }
  }

  let encryptedPrivateKey, certificatePem, certFingerprint, certExpiry;
  if (p12Buffer) {
    const parsed = certificateService.parseCertificate(p12Buffer, p12Password || '');
    encryptedPrivateKey = cryptoService.encrypt(parsed.privateKeyPem);
    certificatePem = parsed.certPem;
    certFingerprint = parsed.certFingerprint;
    certExpiry = parsed.certExpiry;
  } else {
    encryptedPrivateKey = sourceIssuer.encrypted_private_key;
    certificatePem = sourceIssuer.certificate_pem;
    certFingerprint = sourceIssuer.cert_fingerprint;
    certExpiry = sourceIssuer.cert_expiry;
  }

  let newIssuer;
  try {
    newIssuer = await issuerModel.create({
      tenantId: tenant.id,
      ruc: sourceIssuer.ruc,
      businessName: sourceIssuer.business_name,
      tradeName: sourceIssuer.trade_name || null,
      mainAddress: sourceIssuer.main_address || null,
      branchCode: fields.branchCode,
      issuePointCode: fields.issuePointCode,
      environment: sourceIssuer.environment,
      emissionType: sourceIssuer.emission_type,
      requiredAccounting: sourceIssuer.required_accounting,
      specialTaxpayer: sourceIssuer.special_taxpayer || null,
      branchAddress: fields.branchAddress || null,
      encryptedPrivateKey,
      certificatePem,
      certFingerprint,
      certExpiry,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError(`Issuer with branch ${fields.branchCode}, issue point ${fields.issuePointCode} already exists`);
    }
    throw err;
  }

  const documentTypes = Array.isArray(fields.documentTypes) && fields.documentTypes.length > 0
    ? [...new Set(fields.documentTypes)]
    : ['01'];
  await issuerDocumentTypeModel.bulkCreate(newIssuer.id, documentTypes);

  const sequentialMap = {};
  if (Array.isArray(fields.initialSequentials)) {
    for (const entry of fields.initialSequentials) {
      sequentialMap[entry.documentType] = parseInt(entry.sequential, 10);
    }
  }
  for (const docType of documentTypes) {
    await sequentialService.initialize(
      newIssuer.id,
      newIssuer.branch_code,
      newIssuer.issue_point_code,
      docType,
      sequentialMap[docType] || 1,
      tenant.sandbox,
    );
  }

  return {
    issuer: {
      id: newIssuer.id,
      ruc: newIssuer.ruc,
      businessName: newIssuer.business_name,
      tradeName: newIssuer.trade_name || null,
      branchCode: newIssuer.branch_code,
      issuePointCode: newIssuer.issue_point_code,
      branchAddress: newIssuer.branch_address || null,
      certFingerprint: newIssuer.cert_fingerprint || null,
      certExpiry: newIssuer.cert_expiry || null,
    },
  };
}

async function listIssuers(tenantId) {
  const rows = await issuerModel.findAllByTenantId(tenantId);
  return rows.map((i) => ({
    id: i.id,
    ruc: i.ruc,
    businessName: i.business_name,
    tradeName: i.trade_name || null,
    branchCode: i.branch_code,
    issuePointCode: i.issue_point_code,
    branchAddress: i.branch_address || null,
    certFingerprint: i.cert_fingerprint || null,
    certExpiry: i.cert_expiry || null,
  }));
}

module.exports = { createBranch, listDocumentTypes, addDocumentType, removeDocumentType, listIssuers };
