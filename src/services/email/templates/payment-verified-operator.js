const PURPOSE_LABELS = { INITIAL: 'initial subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' };

/**
 * Operator-facing notification that a CARD payment settled itself — not
 * tenant-facing, so no locale system (same as payment-proof-submitted.js).
 *
 * SPI payments deliberately don't send this: the operator is the one who clicks
 * "verify", so they already know. A card payment verifies itself with no human
 * in the loop, so without this nothing would tell them an invoice is now owed.
 * See ADR-028 and docs/guides/payphone-payments.md.
 *
 * @param {object} payment      - DB row from payments table
 * @param {object} subscription - DB row from subscriptions table
 * @param {object} tenant       - DB row from tenants table
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(payment, subscription, tenant) {
  const purposeLabel = PURPOSE_LABELS[payment.purpose] || payment.purpose;
  const amount = parseFloat(payment.total_amount).toFixed(2);
  // For a TIER_CHANGE payment the subscription still reflects its CURRENT
  // tier/interval — target_* on the payment carry what was actually bought.
  // INITIAL/RENEWAL never set target_tier, so this falls back correctly.
  const tier = payment.target_tier || subscription.tier;
  const billingInterval = payment.target_billing_interval || subscription.billing_interval;

  const subject = `[Comprobify] Card payment received — $${amount} ${tier}, invoice owed`;

  const text = [
    `Tenant #${tenant.id} (${tenant.email}) paid by card for a ${purposeLabel}.`,
    'The payment verified itself and their tier is already active — no review needed.',
    '',
    `  Payment ID:        ${payment.id}`,
    `  Subscription ID:   ${subscription.id}`,
    `  Tier:              ${tier}`,
    `  Billing Frequency: ${billingInterval}`,
    `  Amount:            $${amount}`,
    '',
    'You still owe them a factura. The payment is waiting in your invoicing queue:',
    '  GET /v1/admin/invoicing/pending',
    '',
    'Once issued, record it:',
    `  PATCH /v1/admin/subscriptions/${subscription.id}/link-invoice`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>Tenant #${tenant.id} (${escapeHtml(tenant.email)}) paid by card for a ${escapeHtml(purposeLabel)}.</p>
  <p>The payment verified itself and their tier is already active &mdash; no review needed.</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Payment ID</td><td style="padding: 6px 12px;">${payment.id}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Subscription ID</td><td style="padding: 6px 12px;">${subscription.id}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Tier</td><td style="padding: 6px 12px;">${escapeHtml(tier)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Billing Frequency</td><td style="padding: 6px 12px;">${escapeHtml(billingInterval)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Amount</td><td style="padding: 6px 12px;">$${amount}</td></tr>
  </table>
  <p><strong>You still owe them a factura.</strong> The payment is waiting in your invoicing queue:
     <code>GET /v1/admin/invoicing/pending</code></p>
  <p>Once issued, record it: <code>PATCH /v1/admin/subscriptions/${subscription.id}/link-invoice</code></p>
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
