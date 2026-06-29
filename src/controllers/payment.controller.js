const subscriptionService = require('../services/subscription.service');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const submitProof = async (req, res) => {
  if (!req.file) {
    throw new AppError('A proof-of-transfer file is required', 400, ErrorCodes.INVALID_FILE_UPLOAD);
  }
  const payment = await subscriptionService.submitPaymentProof(
    parseInt(req.params.id, 10),
    req.tenant.id,
    { buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype },
  );
  res.json({ ok: true, payment });
};

module.exports = { submitProof };
