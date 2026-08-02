const tenantService = require('../services/tenant.service');
const tenantAgreementService = require('../services/tenant-agreement.service');
const documentTransmission = require('../services/document-transmission.service');

const getMe = async (req, res) => {
  res.json({ ok: true, tenant: req.tenant });
};

const updateLanguage = async (req, res) => {
  await tenantService.updateLanguage(req.tenant.id, req.body.language);
  res.json({ ok: true });
};

const promote = async (req, res) => {
  const result = await tenantService.promote(
    req.tenant.id,
    req.body.initialSequentials || [],
    req.body.tier,
    req.body.billingInterval,
  );
  res.json({ ok: true, ...result });
};

const getAgreementStatus = async (req, res) => {
  const agreements = await tenantService.getAgreementStatus(req.tenant.id);
  res.json({ ok: true, agreements });
};

const acceptAgreements = async (req, res) => {
  await tenantService.acceptAgreements(req.tenant.id, req.body.termsVersion, {
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  res.json({ ok: true });
};

const listTenantAgreements = async (req, res) => {
  const documents = await tenantAgreementService.listForTenant(req.tenant.id);
  res.json({
    ok: true,
    documents: documents.map((d) => ({
      id: d.id,
      documentType: d.document_type,
      templateVersion: d.template_version,
      status: d.status,
      generatedAt: d.generated_at,
      acceptedAt: d.accepted_at || null,
    })),
  });
};

const getTenantAgreement = async (req, res) => {
  const { html, status, templateVersion, acceptedAt } =
    await tenantAgreementService.renderForTenant(req.tenant.id, req.params.type);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Document-Status', status);
  res.setHeader('X-Template-Version', templateVersion);
  if (acceptedAt) res.setHeader('X-Accepted-At', new Date(acceptedAt).toISOString());
  res.send(html);
};

const getEvents = async (req, res) => {
  const events = await tenantService.getEvents(req.tenant.id);
  res.json({ ok: true, events });
};

// Bulk recovery for every stuck document across all of the tenant's
// issuers/branches at once — see document-transmission.service.js's
// retryAllFailedForTenant(). Tenant-wide rather than issuer-scoped
// (unlike everything under /v1/documents/*, which requires X-Issuer-Id)
// on purpose: an SRI-side outage affecting multiple branches shouldn't
// require one call per issuer to recover from.
const retryFailedDocuments = async (req, res) => {
  const effects = await documentTransmission.retryAllFailedForTenant(req.tenant.id);
  res.status(202).json({ ok: true, retried: effects.length, effects });
};

module.exports = {
  getMe, updateLanguage, promote, getAgreementStatus, acceptAgreements,
  listTenantAgreements, getTenantAgreement, getEvents, retryFailedDocuments,
};
