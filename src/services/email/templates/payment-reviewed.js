const { getTranslations } = require('../../../locales');

/**
 * @param {object} payment      - DB row from payments table
 * @param {object} subscription - DB row from subscriptions table
 * @param {'VERIFIED'|'REJECTED'} decision
 * @param {string} language     - locale code (defaults to 'es')
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(payment, subscription, decision, language = 'es') {
  const key = decision === 'VERIFIED' ? 'paymentVerified' : 'paymentRejected';
  const t = getTranslations(language).email[key];

  const purposeLabel = t.purposeLabels[payment.purpose] || t.purposeLabels.INITIAL;
  const amount = parseFloat(payment.amount).toFixed(2);
  const tier = subscription.tier;

  const subject = t.subject(purposeLabel);

  const textLines = [
    t.greeting,
    '',
    t.body(purposeLabel, tier),
    '',
    `  ${t.labelTier}:   ${tier}`,
    `  ${t.labelAmount}: $${amount}`,
  ];
  if (decision === 'REJECTED') {
    textLines.push(`  ${t.labelReason}: ${payment.rejection_reason || ''}`);
  }
  textLines.push('', t.nextSteps, '', t.disclaimer);
  const text = textLines.join('\n');

  const htmlRows = [
    `<tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelTier)}</td><td style="padding: 6px 12px;">${escapeHtml(tier)}</td></tr>`,
    `<tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelAmount)}</td><td style="padding: 6px 12px;">$${amount}</td></tr>`,
  ];
  if (decision === 'REJECTED') {
    htmlRows.push(`<tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelReason)}</td><td style="padding: 6px 12px;">${escapeHtml(payment.rejection_reason || '')}</td></tr>`);
  }

  const html = `
<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>${escapeHtml(t.greeting)}</p>
  <p>${escapeHtml(t.body(purposeLabel, tier))}</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    ${htmlRows.join('\n    ')}
  </table>
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
