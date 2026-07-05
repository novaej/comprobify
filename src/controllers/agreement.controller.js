const agreementService = require('../services/agreement.service');

const list = async (req, res) => {
  const documents = await agreementService.listCurrent();
  res.json({
    ok: true,
    documents: documents.map((d) => ({
      documentType: d.document_type,
      version: d.version,
      url: `/v1/agreements/${d.document_type}`,
    })),
  });
};

const getByType = async (req, res) => {
  const { html, version } = await agreementService.getCurrentHtml(req.params.type);
  const body = agreementService.buildDisclaimer(version) + html;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(agreementService.wrapDocumentHtml(req.params.type, body));
};

module.exports = { list, getByType };
