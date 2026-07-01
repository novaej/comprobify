const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MarkdownIt = require('markdown-it');
const legalDocumentModel = require('../models/legal-document.model');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const markdownRenderer = new MarkdownIt();

const DOCUMENT_TYPES = ['TERMS', 'PRIVACY', 'DPA'];

// Maps each document type to its canonical source file in docs/legal/.
// POST /v1/admin/legal-documents reads from here — no content in the body.
const DOCUMENT_FILE_MAP = {
  TERMS:   path.join(process.cwd(), 'docs/legal/terminos-de-servicio.md'),
  PRIVACY: path.join(process.cwd(), 'docs/legal/politica-de-privacidad.md'),
  DPA:     path.join(process.cwd(), 'docs/legal/acuerdo-procesamiento-datos.md'),
};

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

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

// Reads the source file for documentType, strips the draft header, and
// publishes the clean Markdown to the database. version is set by the caller
// (the admin) so they control the canonical version string.
async function publish(documentType, version) {
  const filePath = DOCUMENT_FILE_MAP[documentType];
  const raw = fs.readFileSync(filePath, 'utf8');
  const contentMarkdown = stripDraftHeader(raw);
  const contentHash = sha256Hex(contentMarkdown);
  return legalDocumentModel.create({ documentType, version, contentMarkdown, contentHash });
}

async function getCurrent(documentType) {
  const doc = await legalDocumentModel.findCurrentByType(documentType);
  if (!doc) throw new NotFoundError('Legal document', ErrorCodes.LEGAL_DOCUMENT_NOT_FOUND);
  return doc;
}

async function listCurrent() {
  return legalDocumentModel.findAllCurrent();
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

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_FILE_MAP,
  publish,
  getCurrent,
  listCurrent,
  renderHtml,
  getCurrentHtml,
  substitutePlaceholders,
  formatDate,
  stripDraftHeader,
};
