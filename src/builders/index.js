const InvoiceBuilder = require('./invoice.builder');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const builders = {
  '01': InvoiceBuilder,
};

function getBuilder(documentTypeCode, issuer) {
  const BuilderClass = builders[documentTypeCode];
  if (!BuilderClass) {
    throw new AppError(
      `No builder registered for document type: ${documentTypeCode}`,
      500,
      ErrorCodes.BUILDER_NOT_FOUND,
      false
    );
  }
  return new BuilderClass(issuer);
}

const SUPPORTED_TYPES = Object.keys(builders);

module.exports = { getBuilder, SUPPORTED_TYPES };
