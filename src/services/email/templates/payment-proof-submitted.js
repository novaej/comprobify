const PURPOSE_LABELS = { INITIAL: 'initial subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' };

/**
 * Operator-facing notification — not tenant-facing, so no locale system.
 *
 * @param {object} payment         - DB row from payments table
 * @param {object} subscription    - DB row from subscriptions table
 * @param {object} tenant          - DB row from tenants table
 * @param {string} referenceNumber - bank transfer reference number the tenant supplied
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(payment, subscription, tenant, referenceNumber) {
  const purposeLabel = PURPOSE_LABELS[payment.purpose] || payment.purpose;
  const amount = parseFloat(payment.total_amount).toFixed(2);
  // For a TIER_CHANGE payment, the subscription still reflects its CURRENT
  // tier/interval — target_tier/target_billing_interval on the payment carry
  // what's actually being purchased. INITIAL/RENEWAL payments never set
  // target_tier, so this correctly falls back to the subscription's own.
  const tier = payment.target_tier || subscription.tier;
  const billingInterval = payment.target_billing_interval || subscription.billing_interval;

  const subject = `[Comprobify] Payment proof submitted — tenant #${tenant.id}, payment #${payment.id}`;

  const text = [
    `Tenant #${tenant.id} (${tenant.email}) uploaded proof for a ${purposeLabel} payment.`,
    '',
    `  Payment ID:        ${payment.id}`,
    `  Subscription ID:   ${subscription.id}`,
    `  Tier:              ${tier}`,
    `  Billing Frequency: ${billingInterval}`,
    `  Amount:            $${amount}`,
    `  Reference Number:  ${referenceNumber}`,
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
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Tier</td><td style="padding: 6px 12px;">${escapeHtml(tier)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Billing Frequency</td><td style="padding: 6px 12px;">${escapeHtml(billingInterval)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Amount</td><td style="padding: 6px 12px;">$${amount}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Reference Number</td><td style="padding: 6px 12px;">${escapeHtml(referenceNumber)}</td></tr>
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
