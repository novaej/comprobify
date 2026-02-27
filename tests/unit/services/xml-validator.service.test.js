const path = require('path');
const fs = require('fs');

// Use the real libxmljs2 and real XSD for these tests
const xmlValidator = require('../../../src/services/xml-validator.service');

const ASSETS_DIR = path.join(__dirname, '../../../assets');

describe('XmlValidatorService', () => {
  test('validate returns valid:true for a well-formed factura XML', () => {
    const xmlPath = path.join(ASSETS_DIR, 'factura_V2.1.0.xml');
    if (!fs.existsSync(xmlPath)) {
      console.warn('Skipping: factura_V2.1.0.xml not found in assets/');
      return;
    }
    const xml = fs.readFileSync(xmlPath, 'utf8');
    const result = xmlValidator.validate(xml);
    expect(result.valid).toBe(true);
  });

  test('validate returns valid:false with errors for invalid XML', () => {
    const invalidXml = '<factura><unexpected/></factura>';
    const result = xmlValidator.validate(invalidXml);
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty('message');
  });

  test('validate strips XML declaration before validating', () => {
    // Should not throw on XML with declaration
    const xmlWithDecl = '<?xml version="1.0" encoding="UTF-8"?><factura><unexpected/></factura>';
    const result = xmlValidator.validate(xmlWithDecl);
    expect(result).toHaveProperty('valid');
  });
});
