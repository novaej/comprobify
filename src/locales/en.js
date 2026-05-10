module.exports = {
  email: {
    verifyEmail: {
      subject: 'Verify your Comprobify email address',
      greeting: 'Welcome to Comprobify!',
      cta: 'Verify your email address to activate your account. You will also need an active account to enable production invoicing:',
      expiry: (ttlLabel) => `This link expires in ${ttlLabel}.`,
      ttlLabel: (hours) => hours === 1 ? '1 hour' : `${hours} hours`,
      disclaimer: 'If you did not sign up for Comprobify, you can ignore this email.',
    },
  },
};
