const registrationService = require('../services/registration.service');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const MAX_LOGO_BYTES = 500 * 1024;

const register = async (req, res) => {
  const logoFile = req.files?.logo?.[0] || null;
  if (logoFile && logoFile.size > MAX_LOGO_BYTES) {
    throw new AppError('Logo file must not exceed 500 KB', 400, ErrorCodes.INVALID_FILE_UPLOAD);
  }
  const logoBuffer = logoFile?.buffer || null;
  const result = await registrationService.register(req.body, req.file?.buffer, req.body.certPassword, logoBuffer);
  const { tenant, issuer, apiKey } = result;
  res.status(201).json({ ok: true, tenant, issuer, apiKey });
};

const recover = async (req, res) => {
  const result = await registrationService.recover(req.body.email, req.file?.buffer, req.body.certPassword);
  res.json(result);
};

const verifyEmail = async (req, res) => {
  const { email } = await registrationService.verifyEmail(req.query.token);
  res.json({ ok: true, email, message: 'Email verified. You can now promote your account to production.' });
};

// Read-only counterpart of verifyEmail — safe for a link-scanner's automated
// GET to hit repeatedly, since it never consumes the token.
const checkVerifyEmail = async (req, res) => {
  const result = await registrationService.checkVerificationToken(req.query.token);
  res.json(result);
};

// The actual consuming action. POST-only so an automated prefetch (which
// only ever issues GET) can't trigger it — only an explicit user action
// (the frontend button click) can.
const confirmVerifyEmail = async (req, res) => {
  const { email } = await registrationService.verifyEmail(req.body.token);
  res.json({ ok: true, email, message: 'Email verified. You can now promote your account to production.' });
};

const resendVerification = async (req, res) => {
  await registrationService.resendVerification(req.body.email, req.body.verificationRedirectUrl);
  res.json({ ok: true, message: 'If that email is registered and unverified, a new verification email has been sent.' });
};

module.exports = { register, recover, resendVerification, verifyEmail, checkVerifyEmail, confirmVerifyEmail };
