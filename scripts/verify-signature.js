#!/usr/bin/env node
/**
 * Offline XAdES-BES signature verifier for SRI signed invoices.
 *
 * Usage: node scripts/verify-signature.js <signed.xml>
 *
 * Auto-detects SHA-1 vs SHA-256 from the SignatureMethod and tests accordingly.
 */

const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const xmlFile = process.argv[2];
if (!xmlFile) {
  console.error('Usage: node scripts/verify-signature.js <signed.xml>');
  process.exit(1);
}

const xml = fs.readFileSync(path.resolve(xmlFile), 'utf8');

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function digestBase64(str, algo, encoding) {
  const md = algo === 'sha256' ? forge.md.sha256.create() : forge.md.sha1.create();
  md.update(str, encoding || 'utf8');
  return Buffer.from(md.digest().toHex(), 'hex').toString('base64');
}

function extractElement(xml, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return null;
  const end = xml.indexOf(close, start) + close.length;
  return xml.substring(start, end);
}

function check(label, computed, expected) {
  const ok = computed === expected;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    console.log(`       computed: ${computed}`);
    console.log(`       in XML:   ${expected}`);
  }
  return ok;
}

// -----------------------------------------------------------------------
// 1. Parse certificate and public key
// -----------------------------------------------------------------------

const certMatch = xml.match(/<ds:X509Certificate>([\s\S]*?)<\/ds:X509Certificate>/);
if (!certMatch) { console.error('Could not find X509Certificate'); process.exit(1); }
const certB64 = certMatch[1].replace(/\s/g, '');
const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(certB64)));
const pubKey = cert.publicKey;

console.log('=== Certificate ===');
console.log(`Subject: ${cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', ')}`);
console.log(`Valid: ${cert.validity.notBefore.toISOString()} → ${cert.validity.notAfter.toISOString()}`);
console.log(`Expired: ${new Date() > cert.validity.notAfter}`);
console.log();

// -----------------------------------------------------------------------
// 2. Detect signature algorithm
// -----------------------------------------------------------------------

const isSha256 = xml.includes('rsa-sha256') || xml.includes('xmlenc#sha256');
const sigAlgo = isSha256 ? 'sha256' : 'sha1';
console.log(`=== Detected algorithm: RSA-${sigAlgo.toUpperCase()} ===\n`);

// -----------------------------------------------------------------------
// 3. Verify RSA signature over SignedInfo
// -----------------------------------------------------------------------

console.log('=== Signature Verification ===');

const nsDs   = 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
const nsEtsi = 'xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#"';

const signedInfoRaw = extractElement(xml, 'ds:SignedInfo');
if (!signedInfoRaw) { console.error('Cannot find ds:SignedInfo'); process.exit(1); }

const sigValMatch = xml.match(/<ds:SignatureValue[^>]*>([\s\S]*?)<\/ds:SignatureValue>/);
if (!sigValMatch) { console.error('Cannot find ds:SignatureValue'); process.exit(1); }
const sigBytes = forge.util.decode64(sigValMatch[1].replace(/\s/g, ''));

function verifySig(label, canonical, algo) {
  try {
    const md = algo === 'sha256' ? forge.md.sha256.create() : forge.md.sha1.create();
    md.update(canonical, 'utf8');
    const ok = pubKey.verify(md.digest().bytes(), sigBytes);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
    return ok;
  } catch (e) {
    console.log(`[FAIL] ${label} (error: ${e.message})`);
    return false;
  }
}

const canonical = signedInfoRaw.replace('<ds:SignedInfo', `<ds:SignedInfo ${nsDs} ${nsEtsi}`);
verifySig(`RSA-${sigAlgo.toUpperCase()} sig (xmlns:ds + xmlns:etsi)`, canonical, sigAlgo);

console.log();

// -----------------------------------------------------------------------
// 4. Verify Reference digests
// -----------------------------------------------------------------------

console.log('=== Reference Digest Verification ===');

// #comprobante — body after removing the Signature element
const body = xml
  .replace(/^<\?xml[^?]*\?>\s*/, '')
  .replace(/<ds:Signature[\s\S]*<\/ds:Signature>\s*/, '');
const expectedComprobante = (xml.match(/URI="#comprobante"[\s\S]*?<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/) || [])[1]?.trim() ?? null;
check(`#comprobante digest (${sigAlgo})`, digestBase64(body, sigAlgo, 'utf8'), expectedComprobante);

// SignedProperties
const signedPropsRaw = extractElement(xml, 'etsi:SignedProperties');
const canonicalSP = signedPropsRaw.replace('<etsi:SignedProperties', `<etsi:SignedProperties ${nsDs} ${nsEtsi}`);
const expectedSP = (xml.match(/Type="http:\/\/uri\.etsi\.org\/01903#SignedProperties"[\s\S]*?<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/) || [])[1]?.trim() ?? null;
check(`SignedProperties digest (${sigAlgo})`, digestBase64(canonicalSP, sigAlgo), expectedSP);

console.log();
