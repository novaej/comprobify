const registrationService = require('../services/registration.service');

const register = async (req, res) => {
  const result = await registrationService.register(req.body, req.file?.buffer, req.body.certPassword);
  const { tenant, issuer, apiKey, recovered } = result;
  res.status(recovered ? 200 : 201).json({ ok: true, tenant, issuer, apiKey });
};

const verifyEmail = async (req, res) => {
  const { email } = await registrationService.verifyEmail(req.query.token);
  res.json({ ok: true, email, message: 'Email verified. You can now promote your account to production.' });
};

const resendVerification = async (req, res) => {
  await registrationService.resendVerification(req.body.email, req.body.verificationRedirectUrl);
  res.json({ ok: true, message: 'If that email is registered and unverified, a new verification email has been sent.' });
};

module.exports = { register, resendVerification, verifyEmail };
