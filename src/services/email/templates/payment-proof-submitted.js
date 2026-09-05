const PURPOSE_LABELS = { INITIAL: 'initial subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' };

const money = (n) => `$${parseFloat(n).toFixed(2)}`;
const pct = (fraction) => `${(fraction * 100).toFixed(1)}%`;

// English-only breakdown lines (operator-facing, no locale system) — mirrors
// notification-email-template.service.js's formatPricingBreakdown, same
// pricing_breakdown shape (see migration 101). Returns [] when the payment
// has none (INITIAL/RENEWAL never set one).
function breakdownLines(breakdown) {
  if (!breakdown) return [];
  switch (breakdown.model) {
    case 'SAME_INTERVAL_UPGRADE':
      return [
        ['Current plan', money(breakdown.currentTierPrice)],
        ['New plan', money(breakdown.newTierPrice)],
        [`Prorated difference (${pct(breakdown.remainingFraction)} of period remaining)`, money(breakdown.proratedBase)],
      ];
    case 'CROSS_INTERVAL_UPGRADE':
      return [
        ['New plan', money(breakdown.newTierPrice)],
        ...(breakdown.seatsCount > 0 ? [[`Extra seats (${breakdown.seatsCount} x ${money(breakdown.seatPrice)})`, money(breakdown.seatsCost)]] : []),
        ['Subtotal', money(breakdown.fullPrice)],
        ['Credit for unused time on the previous plan', `-${money(breakdown.credit)}`],
      ];
    case 'DEFERRED_FULL_PRICE':
      return [
        ['New plan', money(breakdown.newTierPrice)],
        ...(breakdown.seatsCount > 0 ? [[`Extra seats (${breakdown.seatsCount} x ${money(breakdown.seatPrice)})`, money(breakdown.seatsCost)]] : []),
        ['Full price (not prorated)', money(breakdown.fullPrice)],
      ];
    case 'SEAT_INCREASE':
      return [
        ['Extra seats added', String(breakdown.seatDelta)],
        ['Price per seat', money(breakdown.seatPrice)],
        [`Prorated (${pct(breakdown.remainingFraction)} of period remaining)`, money(breakdown.proratedBase)],
      ];
    default:
      return [];
  }
}

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
  const breakdown = breakdownLines(payment.pricing_breakdown);

  const subject = `[Comprobify] Payment proof submitted — tenant #${tenant.id}, payment #${payment.id}`;

  const text = [
    `Tenant #${tenant.id} (${tenant.email}) uploaded proof for a ${purposeLabel} payment.`,
    '',
    `  Payment ID:        ${payment.id}`,
    `  Payment Code:      ${payment.payment_code}`,
    `  Subscription ID:   ${subscription.id}`,
    `  Tier:              ${tier}`,
    `  Billing Frequency: ${billingInterval}`,
    `  Amount:            $${amount}`,
    `  Reference Number:  ${referenceNumber}`,
    ...(breakdown.length ? ['', 'How this was calculated:', ...breakdown.map(([label, value]) => `  ${label}: ${value}`)] : []),
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
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Payment Code</td><td style="padding: 6px 12px; font-family: monospace;">${escapeHtml(payment.payment_code)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Subscription ID</td><td style="padding: 6px 12px;">${subscription.id}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Tier</td><td style="padding: 6px 12px;">${escapeHtml(tier)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Billing Frequency</td><td style="padding: 6px 12px;">${escapeHtml(billingInterval)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Amount</td><td style="padding: 6px 12px;">$${amount}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Reference Number</td><td style="padding: 6px 12px;">${escapeHtml(referenceNumber)}</td></tr>
  </table>
  ${breakdown.length ? `
  <p style="font-weight: bold; margin-bottom: 4px;">How this was calculated:</p>
  <table style="border-collapse: collapse; width: 100%; margin: 0 0 16px;">
    ${breakdown.map(([label, value]) => `<tr><td style="padding: 4px 12px; color: #555;">${escapeHtml(label)}</td><td style="padding: 4px 12px;">${escapeHtml(value)}</td></tr>`).join('\n    ')}
  </table>` : ''}
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
