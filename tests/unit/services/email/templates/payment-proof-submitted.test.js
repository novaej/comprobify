const { render } = require('../../../../../src/services/email/templates/payment-proof-submitted');

describe('payment-proof-submitted template', () => {
  const tenant = { id: 1, email: 'tenant@example.com' };

  test('INITIAL: uses the subscription\'s own tier and billing interval, amount from total_amount', () => {
    const payment = { id: 5, purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { id: 4, tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant);

    expect(text).toContain('Tier:              STARTER');
    expect(text).toContain('Billing Frequency: MONTHLY');
    expect(text).toContain('Amount:            $20.00');
    expect(html).toContain('STARTER');
    expect(html).toContain('MONTHLY');
    expect(html).toContain('$20.00');
  });

  test('TIER_CHANGE: uses the payment\'s target_tier/target_billing_interval, not the subscription\'s current values', () => {
    const payment = {
      id: 5, purpose: 'TIER_CHANGE', amount: 782.61, total_amount: 900,
      target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
    };
    const subscription = { id: 4, tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant);

    expect(text).toContain('Tier:              GROWTH');
    expect(text).not.toContain('Tier:              STARTER');
    expect(text).toContain('Billing Frequency: YEARLY');
    expect(text).toContain('Amount:            $900.00');
    expect(html).toContain('GROWTH');
    expect(html).toContain('YEARLY');
    expect(html).toContain('$900.00');
  });

  test('TIER_CHANGE without a billing-interval change: falls back to the subscription\'s current interval', () => {
    const payment = {
      id: 5, purpose: 'TIER_CHANGE', amount: 60.87, total_amount: 70,
      target_tier: 'GROWTH', target_billing_interval: null,
    };
    const subscription = { id: 4, tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text } = render(payment, subscription, tenant);

    expect(text).toContain('Tier:              GROWTH');
    expect(text).toContain('Billing Frequency: MONTHLY');
  });

  test('still includes the actionable admin endpoint references (operator-facing, not tenant-facing)', () => {
    const payment = { id: 5, purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { id: 4, tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant);

    expect(text).toContain('GET /v1/admin/payments/5/proof');
    expect(text).toContain('PATCH /v1/admin/payments/5/review');
    expect(html).toContain('GET /v1/admin/payments/5/proof');
    expect(html).toContain('PATCH /v1/admin/payments/5/review');
  });
});
