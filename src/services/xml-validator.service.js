const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const XSD_PATH = path.join(__dirname, '../../assets/factura_V2.1.0.xsd');

async function validate(xmlString) {
  // Write XML to a temp file — xmllint requires a file path, not stdin, for --schema
  const tmpFile = path.join(os.tmpdir(), `sri-validate-${process.pid}-${Date.now()}.xml`);
  try {
    await fs.writeFile(tmpFile, xmlString, 'utf8');
    await execFileAsync('xmllint', ['--noout', '--schema', XSD_PATH, tmpFile], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { valid: true };
  } catch (err) {
    // xmllint writes validation errors to stderr; exit code is non-zero on failure
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    const errors = stderr
      .split('\n')
      .filter((line) => line.includes('error') || line.includes('invalid'))
      .map((line) => ({ message: line.trim() }));
    return { valid: false, errors: errors.length ? errors : [{ message: stderr }] };
  } finally {
    try { await fs.unlink(tmpFile); } catch (_) { /* ignore cleanup errors */ }
  }
}

module.exports = { validate };
