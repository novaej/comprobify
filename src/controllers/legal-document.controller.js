const legalDocumentService = require('../services/legal-document.service');

const list = async (req, res) => {
  const documents = await legalDocumentService.listCurrent();
  res.json({
    ok: true,
    documents: documents.map((d) => ({
      documentType: d.document_type,
      version: d.version,
      url: `/v1/legal/documents/${d.document_type}`,
    })),
  });
};

const getByType = async (req, res) => {
  const { html, version } = await legalDocumentService.getCurrentHtml(req.params.type);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(legalDocumentService.buildDisclaimer(version) + html);
};

module.exports = { list, getByType };
