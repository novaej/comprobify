// Shared {{token}} substitution — extracted from agreement.service.js so
// notification-email-template.service.js (ADR-024)
// uses the exact same implementation instead of a second copy.
//
// Unmatched tokens are left as-is (`{{unknown}}` stays literal) — a missing
// value is visibly obvious in the rendered output rather than silently
// disappearing, which matters most for legal documents but is a reasonable
// default for email templates too.

// Plain substitution — for text bodies and subject lines, no escaping.
function substitute(text, values = {}) {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, tokenPath) => {
    const value = tokenPath.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), values);
    return value === undefined ? match : String(value);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// HTML-safe substitution — escapes each interpolated value (not the
// surrounding template markup) so metadata that happens to contain `<`/`&`
// can't break the rendered document.
function substituteHtml(html, values = {}) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, tokenPath) => {
    const value = tokenPath.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), values);
    return value === undefined ? match : escapeHtml(value);
  });
}

module.exports = { substitute, substituteHtml, escapeHtml };
