const { getTranslations } = require('../../../locales');

/**
 * @param {object} subscription - DB row from subscriptions table (tier = the tier just lost)
 * @param {string} language     - locale code (defaults to 'es')
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(subscription, language = 'es') {
  const t = getTranslations(language).email.subscriptionExpired;
  const tier = subscription.tier;

  const subject = t.subject(tier);

  const text = [
    t.greeting,
    '',
    t.body(tier),
    '',
    t.nextSteps,
    '',
    t.disclaimer,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>${escapeHtml(t.greeting)}</p>
  <p>${escapeHtml(t.body(tier))}</p>
  <p>${escapeHtml(t.nextSteps)}</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="font-size: 11px; color: #999;">${escapeHtml(t.disclaimer)}</p>
</body>
</html>`.trim();

  return { subject, text, html };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { render };
