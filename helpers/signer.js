/**
 * XAdES-BES XML digital signature implementation for Ecuador's SRI.
 *
 * XAdES-BES (XML Advanced Electronic Signatures — Basic Electronic Signature)
 * is a standard that wraps an XMLDSig signature with additional signed
 * properties: signing time and the signer's certificate reference. SRI
 * requires this format for all electronic documents.
 *
 * High-level signing flow:
 *  1. Load and parse the P12 certificate (PKCS#12 bundle)
 *  2. Extract the signing key and certificate, detect CA (Banco Central / Security Data)
 *  3. Validate the certificate has not expired
 *  4. Build the XAdES SignedProperties block (signing time + certificate digest)
 *  5. Build the KeyInfo block (public key modulus/exponent + X.509 certificate)
 *  6. Build the SignedInfo block — contains SHA-1 digests of:
 *       - the original XML document (Reference URI="#comprobante")
 *       - the KeyInfo block
 *       - the SignedProperties block
 *  7. RSA-SHA1 sign the canonicalised SignedInfo with the private key
 *  8. Assemble the full <ds:Signature> element and inject it into the XML
 *
 * Note: SRI mandates SHA-1 (not SHA-256) for XMLDSig digests and the RSA
 * signature. This is a legal requirement, not a design choice.
 */

var forge = require('node-forge');
var Buffer = require('buffer/').Buffer;
var fs = require('fs');

/**
 * Hashes text with SHA-1 and returns the result as a Base64 string.
 * Used to compute digests for the XMLDSig Reference elements.
 *
 * @param {string} text
 * @param {string} [encoding] - forge encoding hint (e.g. 'utf8')
 * @returns {string} Base64-encoded SHA-1 digest
 */
const sha1ToBase64 = (text, encoding) => {
    let md = forge.md.sha1.create();
    md.update(text, encoding);

    const hash = md.digest().toHex();
    const buffer = new Buffer(hash, 'hex');
    const base64 = buffer.toString('base64');

    return base64;
}

/**
 * Converts a hex string to Base64.
 * Used to encode the RSA public exponent into KeyInfo.
 *
 * @param {string} hexStr
 * @returns {string} Base64 string
 */
const hexToBase64 = (hexStr) => {
    // Ensure even number of hex characters before splitting into byte pairs
    hexStr = hexStr.padStart(hexStr.length + (hexStr.length % 2), "0");
    const bytes = hexStr.match(/.{2}/g).map(byte => parseInt(byte, 16));

    return btoa(String.fromCharCode(...bytes));
}

/**
 * Converts a BigInt (RSA modulus) to a Base64 string formatted at 76
 * characters per line, as required by the XMLDSig KeyValue element.
 *
 * @param {BigInt} bigint - RSA modulus from the certificate's public key
 * @returns {string} Base64 string with line breaks every 76 characters
 */
const bigintToBase64 = (bigint) => {
    const hexStr = bigint.toString(16);
    const hexPairs = hexStr.match(/\w{2}/g);
    const bytes = hexPairs.map(pair => parseInt(pair, 16));
    const byteString = String.fromCharCode(...bytes);
    const base64 = btoa(byteString);
    // XMLDSig requires Base64 content to be line-wrapped at 76 chars
    const formattedBase64 = base64.match(/.{1,76}/g).join('\n');

    return formattedBase64;
}

/**
 * Returns a random 6-digit integer used to generate unique IDs for the
 * XML signature elements (Signature, SignedProperties, KeyInfo, etc.).
 * Uniqueness within a single document is sufficient — collisions across
 * documents are harmless.
 *
 * @param {number} [min=100000]
 * @param {number} [max=999999]
 * @returns {number}
 */
const getRandomNumber = (min = 100000, max = 999999) => {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Signs an XML string using the provided P12 certificate (XAdES-BES).
 *
 * The function supports certificates issued by both Ecuadorian CAs:
 *  - Banco Central del Ecuador (BCE) — signing key identified by "Signing Key"
 *    friendly name inside the PKCS#12 bag
 *  - Security Data — signing key is always the first PKCS8 bag entry
 *
 * @param {string} p12Path     - Filesystem path to the .p12 certificate file
 * @param {string} p12Password - Plaintext password for the .p12 file
 * @param {string} xmlString   - Unsigned XML document (must have id="comprobante")
 * @returns {string}           - XML with the <ds:Signature> block injected
 *                               before the closing root tag
 * @throws {Error} If the certificate has expired
 */
const sign = (p12Path, p12Password, xmlString = '') => {

    // --- Step 1: Load and parse the P12 file ---
    // Read the binary P12 file, base64-encode it, then decode back to DER
    // bytes so forge can parse the ASN.1 PKCS#12 structure
    var keyFile = fs.readFileSync(p12Path);
    var keyBase64 = keyFile.toString('base64');

    var p12Der = forge.util.decode64(keyBase64);
    var p12Asn1 = forge.asn1.fromDer(p12Der);
    var p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

    // --- Step 2: Extract certificate and private key bags ---
    // A P12 file contains multiple "bags" — containers for keys and certs.
    // We need the shrouded (encrypted) private key bag and the certificate bag.
    const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.oids.certBag];
    const friendlyName = certBag[1].attributes.friendlyName[0];

    let certificate;
    let pkcs8;
    let issuerName = '';

    // Select the certificate with the most extensions — in a chain this is
    // the end-entity (signer's) certificate rather than an intermediate CA cert
    const cert = certBag.reduce((prev, curr) => curr.cert.extensions.length > prev.cert.extensions.length ? curr : prev);
    const issuerAttrs = cert.cert.issuer.attributes;

    // Build the issuer DN string in reverse RFC 4514 order (C, O, OU, CN ...)
    // required by the XAdES X509IssuerName element
    issuerName = issuerAttrs
        .reverse()
        .map(attr => `${attr.shortName}=${attr.value}`)
        .join(", ");

    // --- Step 3: Locate the private key — CA-specific bag layout ---
    // BCE bundles multiple keys; the signing key is identified by friendly name
    if (/BANCO CENTRAL/i.test(friendlyName)) {
        let keys = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag];

        for (let i = 0; i < keys.length; i++) {
            const element = keys[i];
            let keyFriendlyName = element.attributes.friendlyName[0];
            if (/Signing Key/i.test(keyFriendlyName)) {
                pkcs8 = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag][i];
            }
        }
    }

    // Security Data always places the signing key at index 0
    if (/SECURITY DATA/i.test(friendlyName)) {
        pkcs8 = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag][0];
    }

    certificate = cert.cert;

    // --- Step 4: Validate certificate validity period ---
    const notBefore = certificate.validity['notBefore'];
    const notAfter = certificate.validity['notAfter'];

    const currentDate = new Date();
    if (currentDate < notBefore || currentDate > notAfter) {
        throw new Error('Invalid certificate, certificate has expired');
    }

    // key may be a parsed KeyObject or raw ASN.1 depending on forge version
    const key = pkcs8.key ?? pkcs8.asn1;

    // --- Step 5: Prepare the X.509 certificate for embedding ---
    // Convert the cert to PEM, then strip the header/footer lines to get
    // the raw Base64 content needed inside <ds:X509Certificate>
    const certificateX509_pem = forge.pki.certificateToPem(certificate);
    let certificateX509 = certificateX509_pem.substring(
        certificateX509_pem.indexOf('\n') + 1,
        certificateX509_pem.indexOf('\n-----END CERTIFICATE-----')
    );

    // Normalise line endings then re-wrap at 76 characters per XMLDSig spec
    certificateX509 = certificateX509
        .replace(/\r?\n|\r/g, '')
        .replace(/([^\0]{76})/g, '$1\n');

    // Compute SHA-1 digest of the DER-encoded certificate — goes into
    // XAdES SigningCertificate/CertDigest to bind the cert to the signature
    const certificateX509_asn1 = forge.pki.certificateToAsn1(certificate);
    const certificateX509_der = forge.asn1.toDer(certificateX509_asn1).getBytes;
    const hash_certificateX509_der = sha1ToBase64(certificateX509_der);
    const certificateX509_serialNumber = parseInt(certificate.serialNumber, 16);

    // Extract RSA public key components for the KeyValue element
    const exponent = hexToBase64(key.e.data[0].toString(16));
    const modulus = bigintToBase64(key.n);

    // --- Step 6: Normalise the XML ---
    // Strip tabs and carriage returns, then compute the SHA-1 digest of
    // the document body (without the XML declaration) for the Reference digest
    xmlString = xmlString.replace(/\t|\r/g, '');

    const sha1_xml = sha1ToBase64(
        xmlString.replace('<?xml version="1.0" encoding="UTF-8"?>', ''),
        'utf8'
    );

    // Namespace declarations injected during "canonicalisation" — SRI's
    // approach approximates C14N by adding namespaces to the element being
    // digested rather than running a full C14N transform
    const namespaces = 'xmnls:ds="http://wwww.w3.org/2000/09/xmldsig#" xmnls:etsi="http://uri.etsi.org/01903/v1.3.2#"';

    // Generate unique numeric IDs for all signature sub-elements
    const certificateNumber       = getRandomNumber();
    const signatureNumber         = getRandomNumber();
    const signedPropertiesNumber  = getRandomNumber();
    const signedInfoNumber        = getRandomNumber();
    const signedPropertiesIdNumber = getRandomNumber();
    const referenceIdNumber       = getRandomNumber();
    const signatureValueNumber    = getRandomNumber();
    const objectNumber            = getRandomNumber();

    const isoDateTime = currentDate.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"

    // --- Step 7: Build SignedProperties ---
    // XAdES extension that binds: signing time + certificate digest + issuer info.
    // This block is itself digested and included as a Reference in SignedInfo.
    let signedProperties = '';
    signedProperties += '<etsi:SignedProperties Id="Signature'
        + signatureNumber + '-SignedProperties' + signedPropertiesNumber + '">';

    signedProperties += '<etsi:SignedSignatureProperties>';
    signedProperties += '<etsi:SigningTime>' + isoDateTime + '</etsi:SigningTime>';
    signedProperties += '<etsi:SigningCertificate>'
        + '<etsi:Cert>'
        + '<etsi:CertDigest>'
        + '<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">'
        + '</ds:DigestMethod>'
        + '<ds:DigestValue>' + hash_certificateX509_der
        + '</ds:DigestValue>'
        + '</etsi:CertDigest>'
        + '<etsi:IssuerSerial>'
        + '<ds:X509IssuerName>' + issuerName
        + '</ds:X509IssuerName>'
        + '<ds:X509SerialNumber>' + certificateX509_serialNumber
        + '</ds:X509SerialNumber>'
        + '</etsi:IssuerSerial>'
        + '</etsi:Cert>'
        + '</etsi:SigningCertificate>'
        + '</etsi:SignedSignatureProperties>'
        + '<etsi:SignedDataObjectProperties>'
        + '<etsi:DataObjectFormat ObjectReference="#Reference-ID=' + referenceIdNumber + '">'
        + '<etsi:Description> contenido comprobante'
        + '</etsi:Description>'
        + '<etsi:MimeType> text/xml'
        + '</etsi:MimeType>'
        + '</etsi:DataObjectFormat>'
        + '</etsi:SignedDataObjectProperties>'
        + '</etsi:SignedProperties>';

    // Digest the SignedProperties with namespaces injected (simulated C14N)
    const sha1_signedProperties = sha1ToBase64(signedProperties.replace('<etsi:SignedProperties', '<etsi:SignedProperties ' + namespaces));

    // --- Step 8: Build KeyInfo ---
    // Contains the signer's X.509 certificate and RSA public key components.
    // This block is digested and referenced in SignedInfo to bind the key
    // material to the signature.
    let keyInfo = '';
    keyInfo += '<ds:KeyInfo Id="Certificate' + certificateNumber + '">';
    keyInfo += '\n<ds:X509Data>';
    keyInfo += '\n<ds:X509Certificate>\n';
    keyInfo += certificateX509;
    keyInfo += '\n</ds:X509Certificate>';
    keyInfo += '\n</ds:X509Data>';
    keyInfo += '\n<ds:KeyValue>';
    keyInfo += '\n<ds:RSAKeyValue>';
    keyInfo += '\n<ds:Modulus>\n';
    keyInfo += modulus;
    keyInfo += '\n</ds:Modulus>';
    keyInfo += '\n<ds:Exponent>\n';
    keyInfo += exponent;
    keyInfo += '\n</ds:Exponent>';
    keyInfo += '\n</ds:RSAKeyValue>';
    keyInfo += '\n</ds:KeyValue>';
    keyInfo += '\n</ds:KeyInfo>';

    const sha1_KeyInfo = sha1ToBase64(keyInfo.replace('<ds:KeyInfo', '<ds:KeyInfo ' + namespaces));

    // --- Step 9: Build SignedInfo ---
    // The core XMLDSig structure. Contains three Reference elements, each
    // with a URI pointing to what was digested:
    //   - #Signature…-SignedProperties  → XAdES SignedProperties digest
    //   - #Certificate…                 → KeyInfo digest
    //   - #comprobante                  → the invoice XML body digest
    // SignedInfo itself is then RSA-SHA1 signed to produce SignatureValue.
    let signedInfo = '';
    signedInfo += '<ds:SigendInfo Id="Signature-SignedInfo' + signedInfoNumber + '">';
    signedInfo += '\n<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">';
    signedInfo += '</ds:CanonicalizationMethod>';
    signedInfo += '\n<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1">';
    signedInfo += '</ds:SignatureMethod>';
    // Reference 1: SignedProperties
    signedInfo += '\n<ds:Reference Id="SignedPropertiesID' + signedPropertiesIdNumber + '" Type="http://uri.etsi.org/01903#SignedProperties" URI="#Signature' + signatureNumber + '-SignedProperties' + signedPropertiesNumber + '">';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>';
    signedInfo += sha1_signedProperties;
    signedInfo += '</ds:DigestValue>';
    signedInfo += '\n</ds:Reference>';
    // Reference 2: KeyInfo
    signedInfo += '\n<ds:Reference URI="#Certificate' + certificateNumber + '">';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>';
    signedInfo += sha1_KeyInfo;
    signedInfo += '</ds:DigestValue>';
    signedInfo += '</ds:Reference>';
    // Reference 3: the invoice XML body (enveloped-signature transform strips
    // the Signature element itself from the digest so the document can contain
    // the signature without invalidating it)
    signedInfo += '\n<ds:Reference Id="Reference-ID' + referenceIdNumber + '" URI="#comprobante">';
    signedInfo += '\n<ds:Transforms>';
    signedInfo += '\n<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature">';
    signedInfo += '</ds:Transform>';
    signedInfo += '\n</ds:Transforms>';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>';
    signedInfo += sha1_xml;
    signedInfo += '</ds:DigestValue>';
    signedInfo += '\n</ds:Reference>';
    signedInfo += '\n</ds:SigendInfo>';

    // --- Step 10: RSA-SHA1 sign the canonicalised SignedInfo ---
    // Inject namespaces to simulate C14N, then hash with SHA-1 and sign
    // using the private key extracted from the P12 bag
    const canonicalized_SignedInfo = signedInfo.replace('<ds:SigendInfo', '<ds:SigendInfo ' + namespaces);

    const md = forge.md.sha1.create();
    md.update(canonicalized_SignedInfo, 'utf8');

    // sign() returns raw bytes; encode as Base64 wrapped at 76 chars
    const signature = btoa(key.sign(md)
        .match(/.{1,76}/g)
        .join('\n'));

    // --- Step 11: Assemble the full <ds:Signature> block ---
    let xadesBes = '';
    xadesBes += '<ds:Signature ' + namespaces + ' Id="Signature' + signatureNumber + '">';
    xadesBes += '\n' + signedInfo;
    xadesBes += '\n<ds:SignatureValue Id="SignatureValue' + signatureValueNumber + '">';
    xadesBes += signature;
    xadesBes += '\n</ds:SignatureValue>';
    xadesBes += '\n' + keyInfo;
    xadesBes += '\n<ds:Object Id="Signature' + signatureNumber + '-Object' + objectNumber + '">';
    xadesBes += '\n<etsi:QualifyingProperties Target="#Signature' + signatureNumber + '">';
    xadesBes += signedProperties;
    xadesBes += '\n</etsi:QualifyingProperties>';
    xadesBes += '\n</ds:Object>';
    xadesBes += '</ds:Signature>';

    // --- Step 12: Inject the signature into the XML document ---
    // The regex matches the last opening tag in the document and inserts the
    // Signature block immediately before it (enveloped signature pattern)
    let signed = xmlString.replace(/(<[^<]+)$/, xadesBes + '$1');

    return signed;
}

module.exports = { sha1ToBase64, hexToBase64, bigintToBase64, getRandomNumber, sign };
