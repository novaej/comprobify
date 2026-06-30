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
  const acceptanceContext = { ip: req.ip, userAgent: req.headers['user-agent'] || null };
  const result = await registrationService.register(req.body, req.file?.buffer, req.body.certPassword, logoBuffer, acceptanceContext);
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
