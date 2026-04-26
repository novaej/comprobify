const adminService = require('../services/admin.service');
const AppError = require('../errors/app-error');

const promote = async (req, res) => {
  if (req.tenant.status !== 'ACTIVE') {
    throw new AppError('Email verification required before promoting to production. Check your inbox.', 403);
  }
  const { issuer, apiKey } = await adminService.promoteIssuer(req.issuer.id);
  res.json({ ok: true, issuer, apiKey });
};

module.exports = { promote };
