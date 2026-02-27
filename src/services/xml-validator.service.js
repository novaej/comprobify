const path = require('path');
const fs = require('fs');
const libxmljs = require('libxmljs2');

const XSD_PATH = path.join(__dirname, '../../assets/factura_V2.1.0.xsd');

let cachedSchema = null;

function getSchema() {
  if (!cachedSchema) {
    const xsdContent = fs.readFileSync(XSD_PATH, 'utf8');
    // baseUrl is required so libxmljs2 can resolve the relative xmldsig-core-schema.xsd import
    cachedSchema = libxmljs.parseXml(xsdContent, { baseUrl: `file://${XSD_PATH}` });
  }
  return cachedSchema;
}

function validate(xmlString) {
  // Strip XML declaration before validation
  const stripped = xmlString.replace(/<\?xml[^?]*\?>\s*/i, '');
  const doc = libxmljs.parseXml(stripped);
  const schema = getSchema();

  const valid = doc.validate(schema);
  if (valid) {
    return { valid: true };
  }

  const errors = doc.validationErrors.map((e) => ({ message: e.message.trim() }));
  return { valid: false, errors };
}

module.exports = { validate };
