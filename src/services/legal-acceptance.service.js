const legalAcceptanceModel = require('../models/legal-acceptance.model');
const legalDocumentService = require('./legal-document.service');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

// Validates termsVersion against the currently published TERMS document
// before any expensive work runs (registration's P12 parsing, etc.) — fails
// fast. Only enforced once something has actually been published; pre-launch,
// before the admin has published any documents, there's nothing authoritative
// to check against, so the submitted version is trusted as-is.
async function validateTermsVersion(termsVersion) {
  let current;
  try {
    current = await legalDocumentService.getCurrent('TERMS');
  } catch (err) {
    if (err.code === ErrorCodes.LEGAL_DOCUMENT_NOT_FOUND) return;
    throw err;
  }
  if (termsVersion !== current.version) {
    throw new AppError(
      `termsVersion '${termsVersion}' does not match the currently published version`,
      400,
      ErrorCodes.LEGAL_VERSION_MISMATCH
    );
  }
}

// Records one acceptance row per currently-published document type (TERMS,
// PRIVACY, DPA) — a single checkbox click accepts the whole bundle, but each
// type is logged independently so a later DPA-only republish can be detected
// and re-accepted without implicating ToS/Privacy. Types with nothing
// published yet are silently skipped (nothing to accept).
async function recordAcceptance(tenantId, { ip, userAgent } = {}) {
  const documents = await legalDocumentService.listCurrent();
  for (const doc of documents) {
    await legalAcceptanceModel.create({
      tenantId,
      documentType: doc.document_type,
      version: doc.version,
      contentHash: doc.content_hash,
      ip,
      userAgent,
    });
  }
}

// Per-type comparison: a tenant's latest accepted version for TERMS/PRIVACY/DPA
// vs. whatever is currently published for that type. Returns the list of
// types that changed since the tenant's last acceptance (empty if all current).
async function getStatus(tenantId) {
  const documents = await legalDocumentService.listCurrent();

  const outdated = [];
  for (const doc of documents) {
    const latest = await legalAcceptanceModel.findLatestByTenantAndType(tenantId, doc.document_type);
    if (!latest || latest.version !== doc.version) {
      outdated.push({
        documentType: doc.document_type,
        currentVersion: doc.version,
        acceptedVersion: latest ? latest.version : null,
        url: `/v1/legal/documents/${doc.document_type}`,
      });
    }
  }

  return { needsAcceptance: outdated.length > 0, outdated };
}

module.exports = { validateTermsVersion, recordAcceptance, getStatus };
