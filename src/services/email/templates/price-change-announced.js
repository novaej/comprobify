const moment = require('moment');
const { getTranslations } = require('../../../locales');

/**
 * @param {object} tierPrice - DB row from tier_prices (PUBLISHED, effective_at in the future)
 * @param {number} previousPriceUsd - the price in effect right now
 * @param {string} language     - locale code (defaults to 'es')
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(tierPrice, previousPriceUsd, language = 'es') {
  const t = getTranslations(language).email.priceChangeAnnounced;

  const tier = tierPrice.tier;
  const newPrice = parseFloat(tierPrice.price_usd).toFixed(2);
  const oldPrice = parseFloat(previousPriceUsd).toFixed(2);
  const effectiveDate = moment(tierPrice.effective_at).format('DD/MM/YYYY');

  const subject = t.subject(tier);

  const text = [
    t.greeting,
    '',
    t.body(tier, effectiveDate),
    '',
    `  ${t.labelTier}:         ${tier}`,
    `  ${t.labelBillingInterval}: ${tierPrice.billing_interval}`,
    `  ${t.labelCurrentPrice}: $${oldPrice}`,
    `  ${t.labelNewPrice}:     $${newPrice}`,
    `  ${t.labelEffectiveDate}: ${effectiveDate}`,
    '',
    t.protection,
    '',
    t.disclaimer,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>${escapeHtml(t.greeting)}</p>
  <p>${escapeHtml(t.body(tier, effectiveDate))}</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelTier)}</td><td style="padding: 6px 12px;">${escapeHtml(tier)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelBillingInterval)}</td><td style="padding: 6px 12px;">${escapeHtml(tierPrice.billing_interval)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelCurrentPrice)}</td><td style="padding: 6px 12px;">$${oldPrice}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelNewPrice)}</td><td style="padding: 6px 12px;">$${newPrice}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelEffectiveDate)}</td><td style="padding: 6px 12px;">${effectiveDate}</td></tr>
  </table>
  <p>${escapeHtml(t.protection)}</p>
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
