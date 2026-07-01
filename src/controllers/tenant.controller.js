const tenantService = require('../services/tenant.service');
const tenantLegalDocumentService = require('../services/tenant-legal-document.service');

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

const getLegalStatus = async (req, res) => {
  const legal = await tenantService.getLegalStatus(req.tenant.id);
  res.json({ ok: true, legal });
};

const acceptLegal = async (req, res) => {
  await tenantService.acceptLegal(req.tenant.id, req.body.termsVersion, {
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  res.json({ ok: true });
};

const listLegalDocuments = async (req, res) => {
  const documents = await tenantLegalDocumentService.listForTenant(req.tenant.id);
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

const getLegalDocument = async (req, res) => {
  const { html, status, templateVersion, acceptedAt } =
    await tenantLegalDocumentService.renderForTenant(req.tenant.id, req.params.type);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Document-Status', status);
  res.setHeader('X-Template-Version', templateVersion);
  if (acceptedAt) res.setHeader('X-Accepted-At', new Date(acceptedAt).toISOString());
  res.send(html);
};

module.exports = { getMe, updateLanguage, promote, getLegalStatus, acceptLegal, listLegalDocuments, getLegalDocument };
