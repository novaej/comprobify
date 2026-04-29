const InvoiceBuilder = require('./invoice.builder');

const builders = {
  '01': InvoiceBuilder,
};

function getBuilder(documentTypeCode, issuer) {
  const BuilderClass = builders[documentTypeCode];
  if (!BuilderClass) {
    throw new Error(`No builder registered for document type: ${documentTypeCode}`);
  }
  return new BuilderClass(issuer);
}

const SUPPORTED_TYPES = Object.keys(builders);

module.exports = { getBuilder, SUPPORTED_TYPES };
