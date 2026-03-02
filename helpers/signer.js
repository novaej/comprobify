/**
 * XAdES-BES XML digital signature implementation for Ecuador's SRI.
 *
 * XAdES-BES (XML Advanced Electronic Signatures — Basic Electronic Signature)
 * is a standard that wraps an XMLDSig signature with additional signed
 * properties: signing time and the signer's certificate reference. SRI
 * requires this format for all electronic documents.
 *
 * High-level signing flow:
 *  1. Parse private key and certificate from PEM strings
 *  2. Validate the certificate has not expired
 *  3. Build the XAdES SignedProperties block (signing time + SHA-256 certificate digest)
 *  4. Build the KeyInfo block (X.509 certificate only)
 *  5. Build the SignedInfo block — contains SHA-256 digests of:
 *       - the original XML document (Reference URI="#comprobante")
 *       - the SignedProperties block
 *  6. RSA-SHA256 sign the canonicalised SignedInfo with the private key
 *  7. Assemble the full <ds:Signature> element and inject it into the XML
 */

var forge = require('node-forge');
var Buffer = require('buffer/').Buffer;

/**
 * Hashes bytes with SHA-256 and returns the result as a Base64 string.
 *
 * @param {string} text
 * @param {string} [encoding] - forge encoding hint (e.g. 'utf8')
 * @returns {string} Base64-encoded SHA-256 digest
 */
const sha256ToBase64 = (text, encoding) => {
    const md = forge.md.sha256.create();
    md.update(text, encoding);
    return Buffer.from(md.digest().toHex(), 'hex').toString('base64');
}

/**
 * Kept for backward compatibility / tests.
 * @deprecated Use sha256ToBase64 for new code.
 */
const sha1ToBase64 = (text, encoding) => {
    const md = forge.md.sha1.create();
    md.update(text, encoding);
    return Buffer.from(md.digest().toHex(), 'hex').toString('base64');
}

/**
 * Returns a random 6-digit integer used to generate unique IDs for the
 * XML signature elements (Signature, SignedProperties, etc.).
 *
 * @param {number} [min=100000]
 * @param {number} [max=999999]
 * @returns {number}
 */
const getRandomNumber = (min = 100000, max = 999999) => {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Signs an XML string using the provided private key and certificate PEMs (XAdES-BES).
 *
 * @param {string} privateKeyPem - PEM-encoded RSA private key
 * @param {string} certPem       - PEM-encoded X.509 certificate
 * @param {string} xmlString     - Unsigned XML document (must have id="comprobante")
 * @returns {string}             - XML with the <ds:Signature> block injected
 *                                 before the closing root tag
 * @throws {Error} If the certificate has expired
 */
const sign = (privateKeyPem, certPem, xmlString = '') => {

    // --- Step 1: Parse PEM inputs ---
    const key         = forge.pki.privateKeyFromPem(privateKeyPem);
    const certificate = forge.pki.certificateFromPem(certPem);

    // Build the issuer DN string in reverse order (C, O, OU, CN → CN, OU, O, C)
    // required by the XAdES X509IssuerName element. No spaces after commas —
    // matches the format produced by Java-based SRI signing tools.
    const issuerName = certificate.issuer.attributes
        .slice()
        .reverse()
        .map(attr => `${attr.shortName}=${attr.value}`)
        .join(',');

    // --- Step 2: Validate certificate validity period ---
    const currentDate = new Date();
    if (currentDate < certificate.validity.notBefore || currentDate > certificate.validity.notAfter) {
        throw new Error('Invalid certificate, certificate has expired');
    }

    // --- Step 3: Prepare the X.509 certificate for embedding ---
    const certificateX509_pem = forge.pki.certificateToPem(certificate);
    let certificateX509 = certificateX509_pem
        .substring(
            certificateX509_pem.indexOf('\n') + 1,
            certificateX509_pem.indexOf('\n-----END CERTIFICATE-----')
        )
        .replace(/\r?\n|\r/g, '')
        .replace(/([^\0]{76})/g, '$1\n');

    // Compute SHA-256 digest of the DER-encoded certificate — goes into
    // XAdES SigningCertificate/CertDigest to bind the cert to the signature
    const certificateX509_asn1 = forge.pki.certificateToAsn1(certificate);
    const certificateX509_der = forge.asn1.toDer(certificateX509_asn1).getBytes();
    const hash_certificateX509_der = sha256ToBase64(certificateX509_der);
    const certificateX509_serialNumber = parseInt(certificate.serialNumber, 16);

    // --- Step 4: Normalise the XML ---
    // Strip tabs and carriage returns, then compute the SHA-256 digest of
    // the document body (without the XML declaration) for the Reference digest
    xmlString = xmlString.replace(/\t|\r/g, '');

    const sha256_xml = sha256ToBase64(
        xmlString.replace(/^<\?xml[^?]*\?>\s*/, ''),
        'utf8'
    );

    // Namespace declarations injected during "canonicalisation" — approximates
    // inclusive C14N by adding the ds: and etsi: namespace declarations that
    // <ds:Signature> would contribute to all descendant elements' namespace scope
    const namespaces = 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#"';

    // Generate unique numeric IDs for signature sub-elements
    const signatureNumber         = getRandomNumber();
    const signedPropertiesNumber  = getRandomNumber();
    const signedInfoNumber        = getRandomNumber();
    const signedPropertiesIdNumber = getRandomNumber();
    const referenceIdNumber       = getRandomNumber();
    const signatureValueNumber    = getRandomNumber();
    const objectNumber            = getRandomNumber();

    const isoDateTime = currentDate.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"

    // --- Step 5: Build SignedProperties ---
    // XAdES extension that binds: signing time + SHA-256 certificate digest + issuer info.
    // This block is itself digested and included as a Reference in SignedInfo.
    const signedPropertiesId = 'Signature' + signatureNumber + '-SignedProperties' + signedPropertiesNumber;
    const referenceId = 'Reference-ID' + referenceIdNumber;

    let signedProperties = '';
    signedProperties += '<etsi:SignedProperties Id="' + signedPropertiesId + '">';
    signedProperties += '<etsi:SignedSignatureProperties>';
    signedProperties += '<etsi:SigningTime>' + isoDateTime + '</etsi:SigningTime>';
    signedProperties += '<etsi:SigningCertificate>'
        + '<etsi:Cert>'
        + '<etsi:CertDigest>'
        + '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">'
        + '</ds:DigestMethod>'
        + '<ds:DigestValue>' + hash_certificateX509_der + '</ds:DigestValue>'
        + '</etsi:CertDigest>'
        + '<etsi:IssuerSerial>'
        + '<ds:X509IssuerName>' + issuerName + '</ds:X509IssuerName>'
        + '<ds:X509SerialNumber>' + certificateX509_serialNumber + '</ds:X509SerialNumber>'
        + '</etsi:IssuerSerial>'
        + '</etsi:Cert>'
        + '</etsi:SigningCertificate>'
        + '</etsi:SignedSignatureProperties>'
        + '<etsi:SignedDataObjectProperties>'
        + '<etsi:DataObjectFormat ObjectReference="#' + referenceId + '">'
        + '<etsi:Description>contenido comprobante</etsi:Description>'
        + '<etsi:MimeType>text/xml</etsi:MimeType>'
        + '</etsi:DataObjectFormat>'
        + '</etsi:SignedDataObjectProperties>'
        + '</etsi:SignedProperties>';

    // Digest the SignedProperties with namespaces injected (simulated C14N)
    const sha256_signedProperties = sha256ToBase64(
        signedProperties.replace('<etsi:SignedProperties', '<etsi:SignedProperties ' + namespaces)
    );

    // --- Step 6: Build KeyInfo ---
    // Contains only the X.509 certificate — no KeyValue/RSAKeyValue needed.
    // Not referenced from SignedInfo so no Id attribute required.
    let keyInfo = '';
    keyInfo += '<ds:KeyInfo>';
    keyInfo += '\n<ds:X509Data>';
    keyInfo += '\n<ds:X509Certificate>\n';
    keyInfo += certificateX509;
    keyInfo += '\n</ds:X509Certificate>';
    keyInfo += '\n</ds:X509Data>';
    keyInfo += '\n</ds:KeyInfo>';

    // --- Step 7: Build SignedInfo ---
    // Two Reference elements:
    //   - #comprobante         → the invoice XML body (enveloped-signature transform)
    //   - #…-SignedProperties  → XAdES SignedProperties digest
    let signedInfo = '';
    signedInfo += '<ds:SignedInfo Id="Signature-SignedInfo' + signedInfoNumber + '">';
    signedInfo += '\n<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">';
    signedInfo += '</ds:CanonicalizationMethod>';
    signedInfo += '\n<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256">';
    signedInfo += '</ds:SignatureMethod>';
    // Reference 1: the invoice XML body
    signedInfo += '\n<ds:Reference Id="' + referenceId + '" URI="#comprobante">';
    signedInfo += '\n<ds:Transforms>';
    signedInfo += '\n<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature">';
    signedInfo += '</ds:Transform>';
    signedInfo += '\n</ds:Transforms>';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>' + sha256_xml + '</ds:DigestValue>';
    signedInfo += '\n</ds:Reference>';
    // Reference 2: SignedProperties
    signedInfo += '\n<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#' + signedPropertiesId + '">';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>' + sha256_signedProperties + '</ds:DigestValue>';
    signedInfo += '\n</ds:Reference>';
    signedInfo += '\n</ds:SignedInfo>';

    // --- Step 8: RSA-SHA256 sign the canonicalised SignedInfo ---
    const canonicalized_SignedInfo = signedInfo.replace('<ds:SignedInfo', '<ds:SignedInfo ' + namespaces);

    const md = forge.md.sha256.create();
    md.update(canonicalized_SignedInfo, 'utf8');

    const signature = Buffer.from(key.sign(md), 'binary')
        .toString('base64')
        .match(/.{1,76}/g)
        .join('\n');

    // --- Step 9: Assemble the full <ds:Signature> block ---
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

    // --- Step 10: Inject the signature into the XML document ---
    // Insert immediately before the closing root tag
    let signed = xmlString.replace(/(<[^<]+)$/, xadesBes + '$1');

    return signed;
}

module.exports = { sha1ToBase64, sha256ToBase64, getRandomNumber, sign };
