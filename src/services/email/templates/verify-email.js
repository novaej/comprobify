const { getTranslations } = require('../../../locales');

function render(verificationUrl, ttlHours = 24, language = 'es') {
  const t = getTranslations(language).email.verifyEmail;
  const ttlLabel = t.ttlLabel(ttlHours);
  // verificationUrl is validated as an https(s) URL by the caller
  // (registration.validator.js's isURL check), but it still originates from
  // a client-supplied field (verificationRedirectUrl) — escape before
  // interpolating into HTML, both as link text and as the href attribute
  // value, same as every other template's tenant/buyer-controlled fields.
  const safeUrl = escapeHtml(verificationUrl);
  return {
    subject: t.subject,
    text: `${t.greeting}\n\n${t.cta}\n\n${verificationUrl}\n\n${t.expiry(ttlLabel)}\n\n${t.disclaimer}`,
    html: `<p><strong>${t.greeting}</strong></p>
<p>${t.cta}</p>
<p><a href="${safeUrl}">${safeUrl}</a></p>
<p>${t.expiry(ttlLabel)}</p>
<p style="color:#999;font-size:12px">${t.disclaimer}</p>`,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { render };
