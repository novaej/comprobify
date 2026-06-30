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
  const doc = await legalDocumentService.getCurrent(req.params.type);
  res.setHeader('Content-Type', doc.content_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.document_type.toLowerCase()}-${doc.version}.pdf"`);
  res.send(doc.content);
};

module.exports = { list, getByType };
