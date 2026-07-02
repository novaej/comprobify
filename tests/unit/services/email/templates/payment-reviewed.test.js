const { render } = require('../../../../../src/services/email/templates/payment-reviewed');

describe('payment-reviewed template', () => {
  test('VERIFIED / INITIAL: uses the subscription\'s own tier and billing interval, amount from total_amount', () => {
    const payment = { purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, 'VERIFIED', 'es');

    expect(text).toContain('para el plan STARTER');
    expect(text).toContain('Plan: STARTER');
    expect(text).toContain('Frecuencia: MONTHLY');
    expect(text).toContain('Monto: $20.00');
    expect(html).toContain('STARTER');
    expect(html).toContain('MONTHLY');
    expect(html).toContain('$20.00');
  });

  test('TIER_CHANGE: uses the payment\'s target_tier/target_billing_interval, not the subscription\'s current values', () => {
    const payment = {
      purpose: 'TIER_CHANGE', amount: 782.61, total_amount: 900,
      target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
    };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text } = render(payment, subscription, 'VERIFIED', 'es');

    expect(text).toContain('para el plan GROWTH');
    expect(text).not.toContain('para el plan STARTER');
    expect(text).toContain('Plan: GROWTH');
    expect(text).toContain('Frecuencia: YEARLY');
    expect(text).toContain('Monto: $900.00');
  });

  test('TIER_CHANGE without a billing-interval change: falls back to the subscription\'s current interval', () => {
    const payment = {
      purpose: 'TIER_CHANGE', amount: 60.87, total_amount: 70,
      target_tier: 'GROWTH', target_billing_interval: null,
    };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text } = render(payment, subscription, 'VERIFIED', 'es');

    expect(text).toContain('Plan: GROWTH');
    expect(text).toContain('Frecuencia: MONTHLY');
  });

  test('REJECTED: resolves rejection_reason_code to the correct localized label (es)', () => {
    const payment = { purpose: 'RENEWAL', amount: 16.52, total_amount: 19, rejection_reason_code: 'TRANSFER_NOT_FOUND' };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, 'REJECTED', 'es');

    expect(text).toContain('No se encontró una transferencia coincidente en la cuenta.');
    expect(html).toContain('No se encontró una transferencia coincidente en la cuenta.');
  });

  test('REJECTED: resolves rejection_reason_code to the correct localized label (en)', () => {
    const payment = { purpose: 'RENEWAL', amount: 16.52, total_amount: 19, rejection_reason_code: 'WRONG_ACCOUNT' };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text } = render(payment, subscription, 'REJECTED', 'en');

    expect(text).toContain('The transfer was sent to the wrong account.');
  });

  test('REJECTED: falls back to the OTHER label for a missing/unrecognized rejection_reason_code', () => {
    const payment = { purpose: 'RENEWAL', amount: 16.52, total_amount: 19, rejection_reason_code: null };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text } = render(payment, subscription, 'REJECTED', 'es');

    expect(text).toContain('Contacta a soporte para más detalles.');
  });

  test('REJECTED: the next-steps text no longer references the raw API endpoint', () => {
    const payment = { purpose: 'INITIAL', amount: 17.39, total_amount: 20, rejection_reason_code: 'OTHER' };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const esResult = render(payment, subscription, 'REJECTED', 'es');
    const enResult = render(payment, subscription, 'REJECTED', 'en');

    expect(esResult.text).not.toContain('PATCH /v1/payments');
    expect(enResult.text).not.toContain('PATCH /v1/payments');
  });

  test('VERIFIED: does not include a reason line at all', () => {
    const payment = { purpose: 'INITIAL', amount: 17.39, total_amount: 20 };
    const subscription = { tier: 'STARTER', billing_interval: 'MONTHLY' };

    const { text, html } = render(payment, subscription, 'VERIFIED', 'es');

    expect(text).not.toContain('Motivo');
    expect(html).not.toContain('Motivo');
  });
});
