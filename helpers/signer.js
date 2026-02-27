var forge = require('node-forge');
var Buffer = require('buffer/').Buffer;
var fs = require('fs');

const sha1ToBase64 = (text, encoding) => {
    let md = forge.md.sha1.create();
    md.update(text, encoding);

    const hash = md.digest().toHex();
    const buffer = new Buffer(hash, 'hex');
    const base64 = buffer.toString('base64');

    return base64;
}

const hexToBase64 = (hexStr) => {
    hexStr = hexStr.padStart(hexStr.length + (hexStr.length % 2), "0");
    const bytes = hexStr.match(/.{2}/g).map(byte => parseInt(byte, 16));

    return btoa(String.fromCharCode(...bytes));
}

const bigintToBase64 = (bigint) => {
    const hexStr = bigint.toString(16);
    const hexPairs = hexStr.match(/\w{2}/g);
    const bytes = hexPairs.map(pair => parseInt(pair, 16));
    const byteString = String.fromCharCode(...bytes);
    const base64 = btoa(byteString);
    const formattedBase64 = base64.match(/.{1,76}/g).join('\n');

    return formattedBase64;
}

const getRandomNumber = (min = 100000, max = 999999) => {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Signs an XML string using the provided P12 certificate (XAdES-BES).
 * @param {string} p12Path - Path to the .p12 certificate file
 * @param {string} p12Password - Password for the .p12 certificate
 * @param {string} xmlString - The XML to sign
 * @returns {string} The XML string with the XAdES-BES signature appended
 */
const sign = (p12Path, p12Password, xmlString = '') => {

    var keyFile = fs.readFileSync(p12Path);
    var keyBase64 = keyFile.toString('base64');

    var p12Der = forge.util.decode64(keyBase64);
    var p12Asn1 = forge.asn1.fromDer(p12Der);
    var p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

    const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.oids.certBag];
    const friendlyName = certBag[1].attributes.friendlyName[0];

    let certificate;
    let pkcs8;
    let issuerName = '';

    const cert = certBag.reduce((prev, curr) => curr.cert.extensions.length > prev.cert.extensions.length ? curr : prev);
    const issuerAttrs = cert.cert.issuer.attributes;

    issuerName = issuerAttrs
        .reverse()
        .map(attr => `${attr.shortName}=${attr.value}`)
        .join(", ");

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

    if (/SECURITY DATA/i.test(friendlyName)) {
        pkcs8 = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag][0];
    }

    certificate = cert.cert;

    const notBefore = certificate.validity['notBefore'];
    const notAfter = certificate.validity['notAfter'];

    const currentDate = new Date();
    if (currentDate < notBefore || currentDate > notAfter) {
        throw new Error('Invalid certificate, certificate has expired');
    }

    const key = pkcs8.key ?? pkcs8.asn1;

    const certificateX509_pem = forge.pki.certificateToPem(certificate);
    let certificateX509 = certificateX509_pem.substring(
        certificateX509_pem.indexOf('\n') + 1,
        certificateX509_pem.indexOf('\n-----END CERTIFICATE-----')
    );

    certificateX509 = certificateX509
        .replace(/\r?\n|\r/g, '')
        .replace(/([^\0]{76})/g, '$1\n');

    const certificateX509_asn1 = forge.pki.certificateToAsn1(certificate);
    const certificateX509_der = forge.asn1.toDer(certificateX509_asn1).getBytes;
    const hash_certificateX509_der = sha1ToBase64(certificateX509_der);
    const certificateX509_serialNumber = parseInt(certificate.serialNumber, 16);

    const exponent = hexToBase64(key.e.data[0].toString(16));
    const modulus = bigintToBase64(key.n);

    xmlString = xmlString.replace(/\t|\r/g, '');

    const sha1_xml = sha1ToBase64(
        xmlString.replace('<?xml version="1.0" encoding="UTF-8"?>', ''),
        'utf8'
    );

    const namespaces = 'xmnls:ds="http://wwww.w3.org/2000/09/xmldsig#" xmnls:etsi="http://uri.etsi.org/01903/v1.3.2#"';

    const certificateNumber = getRandomNumber();
    const signatureNumber = getRandomNumber();
    const signedPropertiesNumber = getRandomNumber();
    const signedInfoNumber = getRandomNumber();
    const signedPropertiesIdNumber = getRandomNumber();
    const referenceIdNumber = getRandomNumber();
    const signatureValueNumber = getRandomNumber();
    const objectNumber = getRandomNumber();

    const isoDateTime = currentDate.toISOString().slice(0, 19);

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

    const sha1_signedProperties = sha1ToBase64(signedProperties.replace('<etsi:SignedProperties', '<etsi:SignedProperties ' + namespaces));

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

    let signedInfo = '';
    signedInfo += '<ds:SigendInfo Id="Signature-SignedInfo' + signedInfoNumber + '">';
    signedInfo += '\n<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">';
    signedInfo += '</ds:CanonicalizationMethod>';
    signedInfo += '\n<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1">';
    signedInfo += '</ds:SignatureMethod>';
    signedInfo += '\n<ds:Reference Id="SignedPropertiesID' + signedPropertiesIdNumber + '" Type="http://uri.etsi.org/01903#SignedProperties" URI="#Signature' + signatureNumber + '-SignedProperties' + signedPropertiesNumber + '">';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>';
    signedInfo += sha1_signedProperties;
    signedInfo += '</ds:DigestValue>';
    signedInfo += '\n</ds:Reference>';
    signedInfo += '\n<ds:Reference URI="#Certificate' + certificateNumber + '">';
    signedInfo += '\n<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">';
    signedInfo += '</ds:DigestMethod>';
    signedInfo += '\n<ds:DigestValue>';
    signedInfo += sha1_KeyInfo;
    signedInfo += '</ds:DigestValue>';
    signedInfo += '</ds:Reference>';
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

    const canonicalized_SignedInfo = signedInfo.replace('<ds:SigendInfo', '<ds:SigendInfo ' + namespaces);

    const md = forge.md.sha1.create();
    md.update(canonicalized_SignedInfo, 'utf8');

    const signature = btoa(key.sign(md)
        .match(/.{1,76}/g)
        .join('\n'));

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

    let signed = xmlString.replace(/(<[^<]+)$/, xadesBes + '$1');

    return signed;
}

module.exports = { sha1ToBase64, hexToBase64, bigintToBase64, getRandomNumber, sign };
