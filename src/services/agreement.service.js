const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MarkdownIt = require('markdown-it');
const agreementModel = require('../models/agreement.model');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');
const config = require('../config');

const markdownRenderer = new MarkdownIt();

const AGREEMENT_TYPES = ['TERMS', 'PRIVACY', 'DPA'];

// Maps each document type to its canonical source file in docs/legal/.
// POST /v1/admin/agreements reads from here — no content in the body.
const AGREEMENT_FILE_MAP = {
  TERMS:   path.join(process.cwd(), 'docs/legal/terms-of-service.md'),
  PRIVACY: path.join(process.cwd(), 'docs/legal/privacy-policy.md'),
  DPA:     path.join(process.cwd(), 'docs/legal/data-processing-agreement.md'),
};

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const computeHash = sha256Hex;

// Formats a date as "1 de julio de 2026" (Spanish, used for {{fecha}}).
function formatDate(date) {
  return new Date(date).toLocaleDateString('es-EC', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Strips the draft-header blockquote (the "> BORRADOR PARA REVISIÓN..." block
// at the top of each docs/legal/*.md file) so it never reaches published content.
// Everything up to and including the first blank line before the title is removed.
function stripDraftHeader(markdown) {
  return markdown.replace(/^(?:>.*\n|\n)+/, '').trim();
}

// Reads the source file for documentType, strips the draft header, substitutes
// operator identity tokens from config, and publishes to the database.
// Throws if any OPERATOR_* env var is missing — empty identity in a legal
// document is always wrong so we catch it early rather than publishing silently.
async function publish(documentType, version) {
  const { nombre, ruc, email } = config.operator;
  if (!nombre || !ruc || !email) {
    throw new AppError(
      'OPERATOR_NAME, OPERATOR_RUC, and OPERATOR_EMAIL must all be set before publishing legal documents',
      500,
      ErrorCodes.OPERATOR_CONFIG_MISSING
    );
  }

  const filePath = AGREEMENT_FILE_MAP[documentType];
  const raw = fs.readFileSync(filePath, 'utf8');
  const stripped = stripDraftHeader(raw);
  // Operator identity is the same across all tenants — substitute it at
  // publish time so it's baked into the stored template. Tenant-specific
  // tokens ({{cliente.*}}, {{fechaDocumento}}) are resolved later in
  // tenant-legal-document.service.js when generating per-tenant instances.
  const domicilio = config.operator.domicilio || 'Domicilio disponible previa solicitud razonable';
  const contentMarkdown = substitutePlaceholders(stripped, { operador: { nombre, ruc, email, domicilio } });
  const contentHash = sha256Hex(contentMarkdown);
  const doc = await agreementModel.create({ documentType, version, contentMarkdown, contentHash });
  // Auto-activate: new version becomes current immediately, same UX as before
  // but now reversible via activateVersion().
  await agreementModel.activate(doc.id);
  return doc;
}

// Activates a previously published version as the current one for its type.
// Used to roll back to a prior version without republishing.
async function activateVersion(id) {
  const doc = await agreementModel.activate(id);
  if (!doc) throw new NotFoundError('Legal document', ErrorCodes.AGREEMENT_NOT_FOUND);
  return doc;
}

async function listVersionsByType(documentType) {
  return agreementModel.findAllByType(documentType);
}

async function getCurrent(documentType) {
  const doc = await agreementModel.findCurrentByType(documentType);
  if (!doc) throw new NotFoundError('Legal document', ErrorCodes.AGREEMENT_NOT_FOUND);
  return doc;
}

async function listCurrent() {
  return agreementModel.findAllCurrent();
}

// Replaces {{token}} placeholders with values from a flat or nested object.
// Unmatched tokens are left as-is — a missing value is visibly obvious rather
// than silently disappearing from a legal document.
function substitutePlaceholders(markdown, values = {}) {
  return markdown.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, tokenPath) => {
    const value = tokenPath.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), values);
    return value === undefined ? match : String(value);
  });
}

// Markdown is the only thing ever stored — HTML is rendered on demand, never
// persisted. {{fecha}} is resolved to the document's publication date by
// default; callers can override (e.g. an acceptance-proof view would pass the
// tenant's accepted_at date instead).
function renderHtml(contentMarkdown, values = {}) {
  return markdownRenderer.render(substitutePlaceholders(contentMarkdown, values));
}

async function getCurrentHtml(documentType, values = {}) {
  const doc = await getCurrent(documentType);
  const fecha = values.fecha ?? formatDate(doc.created_at);
  return { html: renderHtml(doc.content_markdown, { fecha, ...values }), version: doc.version };
}

// Returns the notice block prepended to every rendered legal document.
// Professional, transparent without undermining confidence — no mention of
// "not reviewed by a lawyer" which reads as a warning rather than context.
function buildDisclaimer(version) {
  const email = config.operator?.email || '';
  const contact = email
    ? `puede contactarnos en <a href="mailto:${email}" style="color:#495057">${email}</a>`
    : 'puede contactarnos a través de los canales indicados en los documentos';
  return `<div style="background:#f8f9fa;border-left:4px solid #6c757d;padding:12px 16px;margin-bottom:24px;font-size:0.9em;color:#495057">
<strong>Aviso:</strong> Estos documentos han sido elaborados para establecer las condiciones de uso del Servicio y el tratamiento de datos personales. Pueden actualizarse para reflejar cambios en la legislación o en el funcionamiento del Servicio. Si tiene preguntas sobre su contenido, ${contact} antes de aceptarlos.<br><small style="color:#6c757d">Versión: ${version}</small>
</div>
`;
}

module.exports = {
  AGREEMENT_TYPES,
  AGREEMENT_FILE_MAP,
  publish,
  activateVersion,
  listVersionsByType,
  getCurrent,
  listCurrent,
  renderHtml,
  getCurrentHtml,
  substitutePlaceholders,
  computeHash,
  formatDate,
  stripDraftHeader,
  buildDisclaimer,
};
