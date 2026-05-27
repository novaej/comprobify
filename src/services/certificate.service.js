const forge = require('node-forge');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

function parseCertificate(p12Buffer, p12Password) {
  const p12Der = p12Buffer.toString('binary');
  let p12Asn1;
  try {
    p12Asn1 = forge.asn1.fromDer(p12Der);
  } catch {
    throw new AppError('Invalid P12 certificate file — ensure the file is a valid PKCS#12 archive.', 400, ErrorCodes.CERTIFICATE_INVALID);
  }
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);
  } catch {
    throw new AppError('Invalid P12 certificate password.', 400, ErrorCodes.CERTIFICATE_PASSWORD_INVALID);
  }

  const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.oids.certBag];
  const friendlyName = certBag[1].attributes.friendlyName[0];

  const cert = certBag.reduce((prev, curr) =>
    curr.cert.extensions.length > prev.cert.extensions.length ? curr : prev
  ).cert;

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
    throw new AppError(
      'Could not locate a signing key in the P12 certificate. ' +
      'Ensure the file contains a BANCO CENTRAL or SECURITY DATA key bag.',
      400,
      ErrorCodes.CERTIFICATE_KEY_NOT_FOUND
    );
  }

  const now = new Date();
  if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
    throw new AppError(
      `Certificate expired on ${cert.validity.notAfter.toISOString().slice(0, 10)}. Renew it with your CA before uploading.`,
      400,
      ErrorCodes.CERTIFICATE_EXPIRED
    );
  }

  const privateKey = pkcs8.key ?? forge.pki.privateKeyFromAsn1(pkcs8.asn1);
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  const certAsn1 = forge.pki.certificateToAsn1(cert);
  const certDer = forge.asn1.toDer(certAsn1).getBytes();
  const md = forge.md.sha256.create();
  md.update(certDer);
  const certFingerprint = md.digest().toHex();

  return { privateKeyPem, certPem, certExpiry: cert.validity.notAfter, certFingerprint };
}

module.exports = { parseCertificate };
