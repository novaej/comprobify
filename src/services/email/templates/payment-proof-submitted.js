const PURPOSE_LABELS = { INITIAL: 'initial subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' };

/**
 * Operator-facing notification — not tenant-facing, so no locale system.
 *
 * @param {object} payment      - DB row from payments table
 * @param {object} subscription - DB row from subscriptions table
 * @param {object} tenant       - DB row from tenants table
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(payment, subscription, tenant) {
  const purposeLabel = PURPOSE_LABELS[payment.purpose] || payment.purpose;
  const amount = parseFloat(payment.amount).toFixed(2);

  const subject = `[Comprobify] Payment proof submitted — tenant #${tenant.id}, payment #${payment.id}`;

  const text = [
    `Tenant #${tenant.id} (${tenant.email}) uploaded proof for a ${purposeLabel} payment.`,
    '',
    `  Payment ID:      ${payment.id}`,
    `  Subscription ID: ${subscription.id}`,
    `  Tier:             ${subscription.tier}`,
    `  Amount:           $${amount}`,
    '',
    'Review the uploaded file:',
    `  GET /v1/admin/payments/${payment.id}/proof`,
    '',
    'Then record your decision:',
    `  PATCH /v1/admin/payments/${payment.id}/review`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>Tenant #${tenant.id} (${escapeHtml(tenant.email)}) uploaded proof for a ${escapeHtml(purposeLabel)} payment.</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Payment ID</td><td style="padding: 6px 12px;">${payment.id}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Subscription ID</td><td style="padding: 6px 12px;">${subscription.id}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Tier</td><td style="padding: 6px 12px;">${escapeHtml(subscription.tier)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Amount</td><td style="padding: 6px 12px;">$${amount}</td></tr>
  </table>
  <p>Review: <code>GET /v1/admin/payments/${payment.id}/proof</code></p>
  <p>Decide: <code>PATCH /v1/admin/payments/${payment.id}/review</code></p>
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
