const registrationService = require('../services/registration.service');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');

const register = async (req, res) => {
  let result;
  try {
    result = await registrationService.register(req.body, req.file?.buffer, req.body.certPassword);
  } catch (err) {
    if (err.message === 'SUSPENDED') {
      throw new AppError(403, 'This account has been suspended.');
    }
    throw err;
  }
  const { tenant, issuer, apiKey, recovered } = result;
  res.status(recovered ? 200 : 201).json({ ok: true, tenant, issuer, apiKey });
};

const verifyEmail = async (req, res) => {
  try {
    await registrationService.verifyEmail(req.query.token);
  } catch (err) {
    if (err.message === 'INVALID_TOKEN') {
      return res.status(400).json({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        code: 'INVALID_OR_EXPIRED_TOKEN',
        detail: 'Verification token is invalid or has expired.',
        instance: req.originalUrl,
      });
    }
    throw err;
  }
  res.json({ ok: true, message: 'Email verified. You can now promote your issuer to production.' });
};

const resendVerification = async (req, res) => {
  try {
    await registrationService.resendVerification(req.body.email);
  } catch (err) {
    if (err.message === 'ALREADY_VERIFIED') {
      throw new ConflictError('This account is already verified.');
    }
    if (err.message === 'SUSPENDED') {
      throw new AppError('This account has been suspended.', 403);
    }
    if (err.message === 'RESEND_COOLDOWN') {
      throw new AppError('Please wait before requesting another verification email.', 429);
    }
    throw err;
  }
  res.json({ ok: true, message: 'If that email is registered and unverified, a new verification email has been sent.' });
};

module.exports = { register, resendVerification, verifyEmail };
