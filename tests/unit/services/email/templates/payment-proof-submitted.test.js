const { render } = require('../../../../../src/services/email/templates/payment-proof-submitted');

describe('payment-proof-submitted template', () => {
  const tenant = { id: '00000000-0000-0000-0000-000000000001', email: 'tenant@example.com' };

  test('INITIAL: uses the subscription\'s own tier and billing interval, amount from total_amount', () => {
    const payment = { id: '00000000-0000-0000-0000-000000000005', purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { id: '00000000-0000-0000-0000-000000000004', tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant, 'REF-123');

    expect(text).toContain('Tier:              STARTER');
    expect(text).toContain('Billing Frequency: MONTHLY');
    expect(text).toContain('Amount:            $20.00');
    expect(text).toContain('Reference Number:  REF-123');
    expect(html).toContain('STARTER');
    expect(html).toContain('MONTHLY');
    expect(html).toContain('$20.00');
    expect(html).toContain('REF-123');
  });

  test('TIER_CHANGE: uses the payment\'s target_tier/target_billing_interval, not the subscription\'s current values', () => {
    const payment = {
      id: '00000000-0000-0000-0000-000000000005', purpose: 'TIER_CHANGE', amount: 782.61, total_amount: 900,
      target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
    };
    const subscription = { id: '00000000-0000-0000-0000-000000000004', tier: 'STARTER', billing_interval: 'MONTHLY' };

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
      id: '00000000-0000-0000-0000-000000000005', purpose: 'TIER_CHANGE', amount: 60.87, total_amount: 70,
      target_tier: 'GROWTH', target_billing_interval: null,
    };
    const subscription = { id: '00000000-0000-0000-0000-000000000004', tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text } = render(payment, subscription, tenant);

    expect(text).toContain('Tier:              GROWTH');
    expect(text).toContain('Billing Frequency: MONTHLY');
  });

  test('includes a "How this was calculated" breakdown when the payment has one stored', () => {
    const payment = {
      id: '00000000-0000-0000-0000-000000000005', purpose: 'TIER_CHANGE', amount: 4427.27, total_amount: 5091.36,
      target_tier: 'ENTERPRISE', target_billing_interval: 'YEARLY',
      pricing_breakdown: {
        model: 'CROSS_INTERVAL_UPGRADE', newTierPrice: 4500, seatsCount: 3, seatPrice: 50,
        seatsCost: 150, fullPrice: 4650, credit: 222.73, remainingFraction: 0.9678, proratedBase: 4427.27,
      },
    };
    const subscription = { id: '00000000-0000-0000-0000-000000000004', tier: 'BUSINESS', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant);

    expect(text).toContain('How this was calculated:');
    expect(text).toContain('New plan: $4500.00');
    expect(text).toContain('Extra seats (3 x $50.00): $150.00');
    expect(text).toContain('Credit for unused time on the previous plan: -$222.73');
    expect(html).toContain('How this was calculated:');
    expect(html).toContain('$4500.00');
  });

  test('omits the breakdown block entirely when the payment has none (INITIAL/RENEWAL)', () => {
    const payment = { id: '00000000-0000-0000-0000-000000000005', purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { id: '00000000-0000-0000-0000-000000000004', tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant);

    expect(text).not.toContain('How this was calculated');
    expect(html).not.toContain('How this was calculated');
  });

  test('still includes the actionable admin endpoint references (operator-facing, not tenant-facing)', () => {
    const payment = { id: '00000000-0000-0000-0000-000000000005', purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { id: '00000000-0000-0000-0000-000000000004', tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, tenant);

    expect(text).toContain('GET /v1/admin/payments/00000000-0000-0000-0000-000000000005/proof');
    expect(text).toContain('PATCH /v1/admin/payments/00000000-0000-0000-0000-000000000005/review');
    expect(html).toContain('GET /v1/admin/payments/00000000-0000-0000-0000-000000000005/proof');
    expect(html).toContain('PATCH /v1/admin/payments/00000000-0000-0000-0000-000000000005/review');
  });
});
