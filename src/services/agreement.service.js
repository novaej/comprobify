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

// Spanish-only — docs/agreements/*.md source is Spanish, same as the documents
// themselves (no locale system involved here, unlike email/notifications).
const DOCUMENT_TYPE_TITLES = {
  TERMS: 'Términos de Servicio',
  PRIVACY: 'Política de Privacidad',
  DPA: 'Acuerdo de Procesamiento de Datos',
};

// Maps each document type to its canonical source file in docs/agreements/.
// POST /v1/admin/agreements reads from here — no content in the body.
const AGREEMENT_FILE_MAP = {
  TERMS:   path.join(process.cwd(), 'docs/agreements/terms-of-service.md'),
  PRIVACY: path.join(process.cwd(), 'docs/agreements/privacy-policy.md'),
  DPA:     path.join(process.cwd(), 'docs/agreements/data-processing-agreement.md'),
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
// at the top of each docs/agreements/*.md file) so it never reaches published content.
// Everything up to and including the first blank line before the title is removed.
function stripDraftHeader(markdown) {
  return markdown.replace(/^(?:>.*\n|\n)+/, '').trim();
}

// Reads the source file for documentType (or uses rawMarkdown when an admin
// supplies edited content directly — see POST /v1/admin/agreements), strips
// the draft header (only meaningful for the git-authored file, a no-op shape
// for admin-supplied content since it never carries that banner), substitutes
// operator identity tokens from config, and publishes to the database.
// Throws if any OPERATOR_* env var is missing — empty identity in a legal
// document is always wrong so we catch it early rather than publishing silently.
async function publish(documentType, version, rawMarkdown = null) {
  const { nombre, ruc, email } = config.operator;
  if (!nombre || !ruc || !email) {
    throw new AppError(
      'OPERATOR_NAME, OPERATOR_RUC, and OPERATOR_EMAIL must all be set before publishing legal documents',
      500,
      ErrorCodes.OPERATOR_CONFIG_MISSING
    );
  }

  let stripped;
  if (rawMarkdown != null) {
    stripped = stripDraftHeader(rawMarkdown);
  } else {
    const filePath = AGREEMENT_FILE_MAP[documentType];
    const raw = fs.readFileSync(filePath, 'utf8');
    stripped = stripDraftHeader(raw);
  }
  // Operator identity is the same across all tenants — substitute it at
  // publish time so it's baked into the stored template. Tenant-specific
  // tokens ({{cliente.*}}) are resolved later in tenant-agreement.service.js
  // when generating per-tenant instances.
  const domicilio = config.operator.domicilio || 'Domicilio disponible previa solicitud razonable';
  // {{soporte.email}} is for "write to us" invitations (termination requests,
  // "para consultas", exercising data rights) — routed to the support inbox,
  // not the operator's personal address, same reasoning as buildDisclaimer()
  // above. {{operador.email}} stays reserved for identifying the legally
  // responsible party (e.g. the DPA's "Encargado" clause). Falls back to the
  // operator's email (already validated non-empty above) when
  // ADMIN_NOTIFICATION_EMAIL is unset, so a published document never bakes in
  // a blank contact address.
  const soporteEmail = config.adminNotificationEmail || email;
  const contentMarkdown = substitutePlaceholders(stripped, {
    operador: { nombre, ruc, email, domicilio },
    soporte: { email: soporteEmail },
  });
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

// Fetches one specific version's full row (including content_markdown) by its
// own id — id is a global primary key, not scoped per document_type, so no
// type is needed to disambiguate. Used by the admin "edit an existing version"
// flow to pull raw markdown into a UI before resubmitting via publish().
async function getById(id) {
  const doc = await agreementModel.findById(id);
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
// Uses ADMIN_NOTIFICATION_EMAIL (the support inbox), not OPERATOR_EMAIL —
// this is a "have questions before you accept" prompt, not a legal-identity
// contact point. OPERATOR_EMAIL stays reserved for the operator's identity
// baked into the template content itself (data controller contact, account
// termination requests — see docs/agreements/*.md's {{operador.email}} tokens).
function buildDisclaimer(version) {
  const email = config.adminNotificationEmail || '';
  const contact = email
    ? `puede contactarnos en <a href="mailto:${email}" style="color:#495057">${email}</a>`
    : 'puede contactarnos a través de los canales indicados en el documento';
  return `<div style="background:#f8f9fa;border-left:4px solid #6c757d;padding:12px 16px;margin-bottom:24px;font-size:0.9em;color:#495057">
<strong>Aviso:</strong> Este documento ha sido elaborado para establecer las condiciones de uso del Servicio y el tratamiento de datos personales. Puede actualizarse para reflejar cambios en la legislación o en el funcionamiento del Servicio. Si tiene preguntas sobre su contenido, ${contact} antes de aceptarlo.<br><small style="color:#6c757d">Versión: ${version}</small>
</div>
`;
}

// Wraps a rendered document (disclaimer + markdown-it output) in a full,
// self-contained HTML page — the raw fragment markdown-it produces has no
// <head>/<title>/styling, so viewed directly in a browser it reads as
// unstyled plain text. Both GET /v1/agreements/:type and
// GET /v1/tenants/agreements/:type route through this so a tenant or
// prospective client sees a properly formatted, formal-looking document
// (justified body text, a title, spaced/underlined headings, a paper-like
// container) rather than raw HTML. Every document's markdown source already
// opens with its own `# Title — Comprobify` (rendered as <h1>), so this only
// adds the page chrome around it plus the <title> tag for the browser tab.
function wrapDocumentHtml(documentType, bodyHtml) {
  const title = DOCUMENT_TYPE_TITLES[documentType] || documentType;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Comprobify</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 20px;
    background: #f1f3f5;
    font-family: Georgia, 'Times New Roman', Cambria, serif;
    color: #212529;
    line-height: 1.7;
  }
  .doc-container {
    max-width: 820px;
    margin: 0 auto;
    background: #ffffff;
    padding: 56px 64px;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
  }
  h1 {
    font-size: 1.9em;
    text-align: center;
    margin: 0 0 28px;
    padding-bottom: 20px;
    border-bottom: 2px solid #212529;
    letter-spacing: 0.02em;
  }
  h2 {
    font-size: 1.25em;
    margin-top: 2.2em;
    margin-bottom: 0.6em;
    padding-bottom: 6px;
    border-bottom: 1px solid #dee2e6;
    color: #343a40;
  }
  h3 {
    font-size: 1.05em;
    margin-top: 1.6em;
    margin-bottom: 0.5em;
    color: #495057;
  }
  p, li { text-align: justify; hyphens: auto; }
  p { margin: 0 0 1em; }
  ul, ol { margin: 0 0 1em; padding-left: 1.4em; }
  strong { color: #212529; }
  a { color: #1864ab; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
  th, td { border: 1px solid #dee2e6; padding: 8px 12px; text-align: left; }
  hr { border: none; border-top: 1px solid #dee2e6; margin: 2em 0; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .doc-container { box-shadow: none; padding: 0; }
  }
  @media (max-width: 600px) {
    .doc-container { padding: 32px 24px; }
  }
</style>
</head>
<body>
<div class="doc-container">
${bodyHtml}
</div>
</body>
</html>
`;
}

module.exports = {
  AGREEMENT_TYPES,
  AGREEMENT_FILE_MAP,
  publish,
  activateVersion,
  listVersionsByType,
  getCurrent,
  getById,
  listCurrent,
  renderHtml,
  getCurrentHtml,
  substitutePlaceholders,
  computeHash,
  formatDate,
  stripDraftHeader,
  buildDisclaimer,
  wrapDocumentHtml,
};
