function render(verificationUrl, ttlHours = 24) {
  const ttlLabel = ttlHours === 1 ? '1 hour' : `${ttlHours} hours`;
  return {
    subject: 'Verify your Comprobify email address',
    text: `Welcome to Comprobify!\n\nVerify your email address to unlock production invoicing:\n\n${verificationUrl}\n\nThis link expires in ${ttlLabel}.\n\nIf you did not sign up for Comprobify, you can ignore this email.`,
    html: `<p>Welcome to <strong>Comprobify</strong>!</p>
<p>Verify your email address to unlock production invoicing:</p>
<p><a href="${verificationUrl}">${verificationUrl}</a></p>
<p>This link expires in ${ttlLabel}.</p>
<p style="color:#999;font-size:12px">If you did not sign up for Comprobify, you can ignore this email.</p>`,
  };
}

module.exports = { render };
