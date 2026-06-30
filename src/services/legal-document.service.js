const crypto = require('crypto');
const MarkdownIt = require('markdown-it');
const legalDocumentModel = require('../models/legal-document.model');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const markdownRenderer = new MarkdownIt();

const DOCUMENT_TYPES = ['TERMS', 'PRIVACY', 'DPA'];

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function publish(documentType, version, contentMarkdown) {
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

// Replaces {{token}} placeholders (e.g. {{cliente.razonSocial}}) with values
// from a flat or nested object before rendering. Unmatched tokens are left
// as-is rather than blanked out, so a missing value is visibly obvious
// instead of silently disappearing from a legal document.
function substitutePlaceholders(markdown, values = {}) {
  return markdown.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const value = path.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), values);
    return value === undefined ? match : String(value);
  });
}

// Markdown is the only thing ever stored — HTML is always rendered on
// demand, here, via the open-source `markdown-it` parser. Never persisted,
// so there's nothing to keep in sync when the renderer or template changes.
function renderHtml(contentMarkdown, values = {}) {
  return markdownRenderer.render(substitutePlaceholders(contentMarkdown, values));
}

async function getCurrentHtml(documentType, values = {}) {
  const doc = await getCurrent(documentType);
  return { html: renderHtml(doc.content_markdown, values), version: doc.version };
}

module.exports = { DOCUMENT_TYPES, publish, getCurrent, listCurrent, renderHtml, getCurrentHtml, substitutePlaceholders };
