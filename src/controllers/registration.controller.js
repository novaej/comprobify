const registrationService = require('../services/registration.service');
const AppError = require('../errors/app-error');

const register = async (req, res) => {
  const { tenant, issuer, apiKey } = await registrationService.register(
    req.body,
    req.file?.buffer,
    req.body.certPassword,
  );
  res.status(201).json({ ok: true, tenant, issuer, apiKey });
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

module.exports = { register, verifyEmail };
