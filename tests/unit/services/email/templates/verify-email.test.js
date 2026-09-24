const verifyEmail = require('../../../../../src/services/email/templates/verify-email');

const URL_ = 'https://app.example.com/verify?token=abc';

describe('verify-email template', () => {
  test('default copy is the welcome message', () => {
    const { subject, text } = verifyEmail.render(URL_, 24, 'en');

    expect(subject).toBe('Verify your Comprobify email address');
    expect(text).toContain('Welcome to Comprobify!');
    expect(text).toContain('you can ignore this email');
  });

  test('RECOVERY reason is a security notice: no welcome, no "ignore this", warns not to click', () => {
    const { subject, text, html } = verifyEmail.render(URL_, 24, 'en', { reason: 'RECOVERY' });

    expect(subject).toMatch(/recovered/i);
    expect(text).not.toContain('Welcome');
    expect(text).not.toContain('you can ignore this email');
    expect(text).toContain('do not click the link');
    expect(text).toContain(URL_);
    expect(html).toContain('do not click the link');
  });

  test('RECOVERY notice is localised (es) and shares the expiry line', () => {
    const { subject, text } = verifyEmail.render(URL_, 24, 'es', { reason: 'RECOVERY' });

    expect(subject).toMatch(/recuperada/);
    expect(text).toContain('no hagas clic');
    expect(text).toContain('24 horas');
  });

  test('includes the support address only for RECOVERY, and HTML-escapes it', () => {
    const recovery = verifyEmail.render(URL_, 24, 'en', { reason: 'RECOVERY', supportEmail: 'ops@example.com' });
    expect(recovery.text).toContain('Support: ops@example.com');

    const escaped = verifyEmail.render(URL_, 24, 'en', { reason: 'RECOVERY', supportEmail: '<b>x</b>@example.com' });
    expect(escaped.html).not.toContain('<b>x</b>');

    const normal = verifyEmail.render(URL_, 24, 'en', { supportEmail: 'ops@example.com' });
    expect(normal.text).not.toContain('ops@example.com');
  });
});
