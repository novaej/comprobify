const subscriptionService = require('../services/subscription.service');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const submitProof = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('At least one proof-of-transfer file is required', 400, ErrorCodes.INVALID_FILE_UPLOAD);
  }
  const files = req.files.map((file) => ({ buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype }));
  const { payment, proofs } = await subscriptionService.submitPaymentProof(
    req.params.id,
    req.tenant.id,
    files,
    req.body.referenceNumber,
  );
  res.json({ ok: true, payment, proofs });
};

const listProofs = async (req, res) => {
  const proofs = await subscriptionService.listPaymentProofsForTenant(req.params.id, req.tenant.id);
  res.json({ ok: true, proofs });
};

// Streams a single proof file back to the tenant who uploaded it.
// Ownership is verified in getPaymentProofFileForTenant via the subscription join.
const downloadProof = async (req, res) => {
  const { buffer, filename, mimeType } = await subscriptionService.getPaymentProofFileForTenant(
    req.params.id,
    req.params.proofId,
    req.tenant.id,
  );
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
};

const deleteProof = async (req, res) => {
  await subscriptionService.deletePaymentProofForTenant(
    req.params.id,
    req.params.proofId,
    req.tenant.id,
  );
  res.json({ ok: true });
};

module.exports = { submitProof, listProofs, downloadProof, deleteProof };
