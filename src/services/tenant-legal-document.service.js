const tenantLegalDocumentModel = require('../models/tenant-legal-document.model');
const legalDocumentService = require('./legal-document.service');
const issuerModel = require('../models/issuer.model');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');


// Generates personalized document instances for a tenant using the current
// published template versions. If issuer is not provided, fetches the
// tenant's primary issuer automatically (used by lazy-generation paths).
// ON CONFLICT DO NOTHING makes this idempotent — safe to call multiple times.
async function generateForTenant(tenantId, issuer = null) {
  const resolvedIssuer = issuer ?? await issuerModel.findByTenantId(tenantId);
  const templates = await legalDocumentService.listCurrent();
  const created = [];

  for (const template of templates) {
    const values = buildValues(template, resolvedIssuer);
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

async function acceptAll(tenantId, { ip, userAgent } = {}) {
  return tenantLegalDocumentModel.acceptAllPendingByTenant(tenantId, { ip, userAgent });
}

// Per-type status check. Lazily generates PENDING instances for any template
// version the tenant doesn't have a row for yet — so calling this endpoint
// after a new template is published is the mechanism that surfaces the new
// version to the tenant without requiring an admin backfill job.
// This is also what third-party integrators should call periodically to check
// whether the tenant still needs to accept updated documents.
async function getStatus(tenantId) {
  const templates = await legalDocumentService.listCurrent();
  if (templates.length === 0) return { needsAcceptance: false, outdated: [] };

  // Lazy generation: ensure the tenant has a row for every current template
  // version. ON CONFLICT DO NOTHING makes this safe to call any time.
  await generateForTenant(tenantId);

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
        acceptedVersion: latest?.status === 'ACCEPTED' ? latest.template_version : null,
        status: latest ? latest.status : 'NOT_GENERATED',
        url: `/v1/tenants/legal-documents/${template.document_type}`,
        acceptUrl: '/v1/tenants/legal-acceptance',
      });
    }
  }

  return { needsAcceptance: outdated.length > 0, outdated };
}

async function hasAllAccepted(tenantId) {
  const { outdated } = await getStatus(tenantId);
  return outdated.length === 0;
}

async function listForTenant(tenantId) {
  return tenantLegalDocumentModel.findAllByTenant(tenantId);
}

// Returns the tenant's most recent document instance for a given type,
// rendered to HTML with the disclaimer prepended. Lazily generates a PENDING
// row if the tenant has no instance for the current template version.
async function renderForTenant(tenantId, documentType) {
  // Lazy generation: if nothing exists yet (e.g. called before getStatus),
  // create the PENDING row now rather than returning a 404.
  await generateForTenant(tenantId);

  const doc = await tenantLegalDocumentModel.findLatestByTenantAndType(
    tenantId,
    documentType
  );
  if (!doc) {
    throw new AppError(
      `No legal document of type '${documentType}' has been generated for this tenant`,
      404,
      ErrorCodes.LEGAL_DOCUMENT_NOT_FOUND
    );
  }

  const html = legalDocumentService.buildDisclaimer(doc.template_version) + legalDocumentService.renderHtml(doc.content_markdown, {});
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
