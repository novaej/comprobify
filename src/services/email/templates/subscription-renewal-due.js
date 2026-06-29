const moment = require('moment');
const { getTranslations } = require('../../../locales');

/**
 * @param {object} subscription - DB row from subscriptions table
 * @param {object} payment      - DB row from payments table (purpose RENEWAL)
 * @param {object} bankTransfer - config.bankTransfer (bankName, accountType, accountNumber, accountHolder, identification)
 * @param {string} language     - locale code (defaults to 'es')
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(subscription, payment, bankTransfer, language = 'es') {
  const t = getTranslations(language).email.subscriptionRenewalDue;

  const tier = subscription.tier;
  const amount = parseFloat(payment.amount).toFixed(2);
  const dueDate = moment(subscription.current_period_end).format('DD/MM/YYYY');

  const subject = t.subject(tier);

  const text = [
    t.greeting,
    '',
    t.body(tier, dueDate),
    '',
    `  ${t.labelTier}:      ${tier}`,
    `  ${t.labelDueDate}:   ${dueDate}`,
    `  ${t.labelAmount}:    $${amount}`,
    `  ${t.labelPaymentId}: ${payment.id}`,
    '',
    t.bankTransferIntro,
    `  ${t.labelBankName}:       ${bankTransfer.bankName}`,
    `  ${t.labelAccountType}:    ${bankTransfer.accountType}`,
    `  ${t.labelAccountNumber}:  ${bankTransfer.accountNumber}`,
    `  ${t.labelAccountHolder}:  ${bankTransfer.accountHolder}`,
    `  ${t.labelIdentification}: ${bankTransfer.identification}`,
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
  <p>${escapeHtml(t.body(tier, dueDate))}</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelTier)}</td><td style="padding: 6px 12px;">${escapeHtml(tier)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelDueDate)}</td><td style="padding: 6px 12px;">${escapeHtml(dueDate)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelAmount)}</td><td style="padding: 6px 12px;">$${amount}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelPaymentId)}</td><td style="padding: 6px 12px;">${payment.id}</td></tr>
  </table>
  <p>${escapeHtml(t.bankTransferIntro)}</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelBankName)}</td><td style="padding: 6px 12px;">${escapeHtml(bankTransfer.bankName)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelAccountType)}</td><td style="padding: 6px 12px;">${escapeHtml(bankTransfer.accountType)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelAccountNumber)}</td><td style="padding: 6px 12px;">${escapeHtml(bankTransfer.accountNumber)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelAccountHolder)}</td><td style="padding: 6px 12px;">${escapeHtml(bankTransfer.accountHolder)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelIdentification)}</td><td style="padding: 6px 12px;">${escapeHtml(bankTransfer.identification)}</td></tr>
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
