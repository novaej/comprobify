const crypto = require('crypto');
const forge = require('node-forge');
const issuerModel = require('../models/issuer.model');
const apiKeyModel = require('../models/api-key.model');
const sequentialService = require('./sequential.service');
const cryptoService = require('./crypto.service');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');


/**
 * Parses a P12 buffer and extracts the signing key and certificate.
 * Handles both Ecuadorian CAs (Banco Central, Security Data).
 *
 * @param {Buffer} p12Buffer  - Raw bytes of the .p12 file
 * @param {string} p12Password - Plaintext password for the .p12 file
 * @returns {{ privateKeyPem: string, certPem: string, certExpiry: Date, certFingerprint: string }}
 */
function parseCertificate(p12Buffer, p12Password) {
  const p12Der = p12Buffer.toString('binary');
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

  const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.oids.certBag];
  const friendlyName = certBag[1].attributes.friendlyName[0];

  // Select end-entity cert (most extensions)
  const cert = certBag.reduce((prev, curr) =>
    curr.cert.extensions.length > prev.cert.extensions.length ? curr : prev
  ).cert;

  // Locate private key — CA-specific bag layout
  let pkcs8;
  if (/BANCO CENTRAL/i.test(friendlyName)) {
    const keys = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag];
    for (let i = 0; i < keys.length; i++) {
      if (/Signing Key/i.test(keys[i].attributes.friendlyName[0])) {
        pkcs8 = keys[i];
      }
    }
  }

  if (/SECURITY DATA/i.test(friendlyName)) {
    pkcs8 = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag][0];
  }

  if (!pkcs8) {
    throw new AppError('Could not locate signing key in P12 certificate', 400);
  }

  // Validate certificate validity period
  const now = new Date();
  if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
    throw new AppError('Certificate has expired', 400);
  }

  // Extract private key PEM
  const privateKey = pkcs8.key ?? forge.pki.privateKeyFromAsn1(pkcs8.asn1);
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

  // Extract certificate PEM
  const certPem = forge.pki.certificateToPem(cert);

  // Compute SHA-256 fingerprint of DER-encoded cert
  const certAsn1 = forge.pki.certificateToAsn1(cert);
  const certDer = forge.asn1.toDer(certAsn1).getBytes();
  const md = forge.md.sha256.create();
  md.update(certDer);
  const certFingerprint = md.digest().toHex();

  return {
    privateKeyPem,
    certPem,
    certExpiry: cert.validity.notAfter,
    certFingerprint,
  };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Creates a new issuer row and an initial API key.
 *
 * @param {object} fields - Issuer fields from the request body
 * @param {Buffer|undefined} p12Buffer - P12 file buffer (new cert path)
 * @param {string|undefined} p12Password - Plaintext P12 password
 * @param {number|undefined} sourceIssuerId - Copy cert from this issuer (branch path)
 * @returns {{ issuer: object, apiKey: string }}
 */
async function createIssuer(fields, p12Buffer, p12Password, sourceIssuerId) {
  let encryptedPrivateKey, certificatePem, certFingerprint, certExpiry;

  if (p12Buffer) {
    const parsed = parseCertificate(p12Buffer, p12Password || '');
    encryptedPrivateKey = cryptoService.encrypt(parsed.privateKeyPem);
    certificatePem = parsed.certPem;
    certFingerprint = parsed.certFingerprint;
    certExpiry = parsed.certExpiry;
  } else {
    const source = await issuerModel.findById(sourceIssuerId);
    if (!source) {
      throw new AppError('Source issuer not found', 404);
    }
    if (source.ruc !== fields.ruc) {
      throw new AppError('RUC mismatch: source issuer RUC does not match the supplied RUC', 400);
    }
    encryptedPrivateKey = source.encrypted_private_key;
    certificatePem = source.certificate_pem;
    certFingerprint = source.cert_fingerprint;
    certExpiry = source.cert_expiry;
  }

  let newIssuer;
  try {
    newIssuer = await issuerModel.create({
      ruc: fields.ruc,
      businessName: fields.businessName,
      tradeName: fields.tradeName || null,
      mainAddress: fields.mainAddress || null,
      branchCode: fields.branchCode,
      issuePointCode: fields.issuePointCode,
      environment: fields.environment,
      emissionType: fields.emissionType,
      requiredAccounting: [true, 'true', '1', 1].includes(fields.requiredAccounting) ? 'SI' : 'NO',
      specialTaxpayer: fields.specialTaxpayer || null,
      branchAddress: fields.branchAddress || null,
      encryptedPrivateKey,
      certificatePem,
      certFingerprint,
      certExpiry,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError(`Issuer with RUC ${fields.ruc}, branch ${fields.branchCode}, issue point ${fields.issuePointCode} already exists`);
    }
    throw err;
  }

  // Seed sequential counters for each document type specified
  if (Array.isArray(fields.initialSequentials)) {
    for (const entry of fields.initialSequentials) {
      await sequentialService.initialize(
        newIssuer.id,
        newIssuer.branch_code,
        newIssuer.issue_point_code,
        entry.documentType,
        parseInt(entry.sequential, 10),
      );
    }
  }

  // Generate API key — plaintext printed once, never stored
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    issuerId: newIssuer.id,
    keyHash: sha256Hex(plainToken),
    label: 'Initial key',
  });

  return {
    issuer: formatIssuer(newIssuer),
    apiKey: plainToken,
  };
}

async function listIssuers() {
  const rows = await issuerModel.findAll();
  return rows;
}

async function createApiKey(issuerId, label, revokeExisting = false) {
  if (revokeExisting) {
    await apiKeyModel.revokeAllByIssuerId(issuerId);
  }
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    issuerId,
    keyHash: sha256Hex(plainToken),
    label: label || null,
  });
  return plainToken;
}

async function revokeApiKey(id) {
  const row = await apiKeyModel.revoke(id);
  if (!row) {
    throw new AppError('API key not found', 404);
  }
  return row;
}

function formatIssuer(row) {
  return {
    id: row.id,
    ruc: row.ruc,
    businessName: row.business_name,
    tradeName: row.trade_name,
    environment: row.environment,
    branchCode: row.branch_code,
    issuePointCode: row.issue_point_code,
    certFingerprint: row.cert_fingerprint,
    certExpiry: row.cert_expiry,
    active: row.active,
  };
}

module.exports = { createIssuer, listIssuers, createApiKey, revokeApiKey };
