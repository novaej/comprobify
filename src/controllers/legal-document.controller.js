const legalDocumentService = require('../services/legal-document.service');

const DISCLAIMER_HTML = `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:4px;padding:12px 16px;margin-bottom:24px;font-size:0.9em">
<strong>Aviso:</strong> Este documento ha sido generado automáticamente y no ha sido revisado formalmente por un asesor legal. Se proporciona de buena fe como referencia de los términos que rigen el uso del Servicio. Para consultas legales, escriba a <a href="mailto:japc.93@outlook.com">japc.93@outlook.com</a>.
</div>
`;

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
  const { html } = await legalDocumentService.getCurrentHtml(req.params.type);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DISCLAIMER_HTML + html);
};

module.exports = { list, getByType };
