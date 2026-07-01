const tenantLegalDocumentModel = require('../models/tenant-legal-document.model');
const legalDocumentService = require('./legal-document.service');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

// Generates personalized document instances for a tenant using the current
// published template versions. Called at registration and by the admin
// backfill endpoint. Skips any type that has no published template yet.
// Returns the array of created rows (PENDING status).
async function generateForTenant(tenantId, issuer) {
  const templates = await legalDocumentService.listCurrent();
  const created = [];

  for (const template of templates) {
    // Resolve all {{}} tokens into the stored content — the result is an
    // immutable snapshot: no substitution needed at read time.
    const values = buildValues(template, issuer);
    const rendered = legalDocumentService.substitutePlaceholders(
      template.content_markdown,
      values
    );

    const row = await tenantLegalDocumentModel.create({
      tenantId,
      documentType: template.document_type,
      templateVersion: template.version,
      contentMarkdown: rendered,
      contentHash: legalDocumentService.computeHash(rendered),
    });

    if (row) created.push(row);
  }

  return created;
}

// Builds the substitution values for a given template + issuer combination.
// fechaVersion comes from the template's own created_at (when this version
// was published by the admin). fechaDocumento is today — the date this
// per-tenant copy was generated (= registration date).
function buildValues(template, issuer) {
  return {
    fechaVersion: legalDocumentService.formatDate(template.created_at),
    fechaDocumento: legalDocumentService.formatDate(new Date()),
    cliente: {
      razonSocial: issuer?.business_name || '',
      ruc: issuer?.ruc || '',
      email: issuer?.email || '',
    },
  };
}

// Validates that the submitted version matches the current TERMS template —
// same intent as before, but now the version is also used to key the
// tenant_legal_documents rows. Only enforced once something is published.
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

// Accepts all PENDING documents for a tenant in one call (single checkbox UX).
async function acceptAll(tenantId, { ip, userAgent } = {}) {
  return tenantLegalDocumentModel.acceptAllPendingByTenant(tenantId, { ip, userAgent });
}

// Returns per-type status for the tenant — used by GET /v1/tenants/legal-status.
// A type is "pending" if the tenant has no ACCEPTED row for the current
// template version (either not generated yet, or generated but not accepted).
async function getStatus(tenantId) {
  const templates = await legalDocumentService.listCurrent();
  const outdated = [];

  for (const template of templates) {
    const latest = await tenantLegalDocumentModel.findLatestByTenantAndType(
      tenantId,
      template.document_type
    );

    const isAccepted =
      latest &&
      latest.template_version === template.version &&
      latest.status === 'ACCEPTED';

    if (!isAccepted) {
      outdated.push({
        documentType: template.document_type,
        currentVersion: template.version,
        acceptedVersion:
          latest?.status === 'ACCEPTED' ? latest.template_version : null,
        status: latest ? latest.status : 'NOT_GENERATED',
        url: `/v1/tenants/legal-documents/${template.document_type}`,
      });
    }
  }

  return { needsAcceptance: outdated.length > 0, outdated };
}

// Returns true only if the tenant has an ACCEPTED row for the current template
// version of every published document type. Used as the promotion gate.
async function hasAllAccepted(tenantId) {
  const { outdated } = await getStatus(tenantId);
  return outdated.length === 0;
}

// Returns all document instances for the tenant, newest first per type.
async function listForTenant(tenantId) {
  return tenantLegalDocumentModel.findAllByTenant(tenantId);
}

// Returns the tenant's latest document instance for a type, rendered to HTML.
// Since all tokens were resolved at generation time, rendering is just
// markdown → HTML with no further substitution needed.
async function renderForTenant(tenantId, documentType) {
  const doc = await tenantLegalDocumentModel.findLatestByTenantAndType(
    tenantId,
    documentType
  );
  if (!doc) {
    throw new AppError(
      `No legal document of type '${documentType}' has been generated for this tenant yet`,
      404,
      ErrorCodes.LEGAL_DOCUMENT_NOT_FOUND
    );
  }
  const html = legalDocumentService.renderHtml(doc.content_markdown, {});
  return { html, status: doc.status, templateVersion: doc.template_version, acceptedAt: doc.accepted_at };
}

module.exports = {
  generateForTenant,
  validateTermsVersion,
  acceptAll,
  getStatus,
  hasAllAccepted,
  listForTenant,
  renderForTenant,
};
