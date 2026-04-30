const { getTranslations } = require('../../../locales');

function render(verificationUrl, ttlHours = 24, language = 'es') {
  const t = getTranslations(language).email.verifyEmail;
  const ttlLabel = t.ttlLabel(ttlHours);
  return {
    subject: t.subject,
    text: `${t.greeting}\n\n${t.cta}\n\n${verificationUrl}\n\n${t.expiry(ttlLabel)}\n\n${t.disclaimer}`,
    html: `<p><strong>${t.greeting}</strong></p>
<p>${t.cta}</p>
<p><a href="${verificationUrl}">${verificationUrl}</a></p>
<p>${t.expiry(ttlLabel)}</p>
<p style="color:#999;font-size:12px">${t.disclaimer}</p>`,
  };
}

module.exports = { render };
