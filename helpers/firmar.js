var forge = require('node-forge');
var Buffer = require('buffer/').Buffer;
var fs = require('fs');



/**
 * Retrieves a P12 file from the specified URL and returns it as an array buffer
 * @async
 * @function getP12
 * @param {string} path - The URL of de P12 file to retrieve
 * @returns {Promise<ArrayBuffer>} A promise that resolves the P12 file as an array buffer
 * @throws {Error} If an error occurs during the execution of the function
 */
const getP12 = async (path) => {
    const res = await fetch(path);

    if (!res.ok) {
        throw new Error(`Failed to retrieve P12 file: ${res.status} ${res.statusText}`);
    }

    const data = await res.arrayBuffer();
    return data;
}

/**
 * Retrieves a XML file from the specified URL and returns it as a string
 * @async
 * @function getXml
 * @param {string} path - The URL of de XML file to retrieve
 * @returns {Promise<string>} A promise that resolves the XML file as a string
 * @throws {Error} If an error occurs during the execution of the function
 */
const getXml = async (path) => {

    const res = await fetch(path);

    if (!res.ok) {
        throw new Error(`Failed to retrieve XML file: ${res.status} ${res.statusText}`);
    }

    const data = await res.text();
    return data;
}

/**
 * Calculates the SHA-1 hash of the specified text and returns it as a BASE64-encoded string
 * @function sha1ToBase64
 * @param {string} text - The text to hash
 * @param {string} encoding - The encoding of the text (default is utf-8)
 * @returns {string} A base64-encoded string representation of the SHA-1 hash of the text
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
 * Converts an hexadecimal string to Base64-encoded string
 * @function hexToBase64
 * @param {string} hexStr - The hexadecimal string to convert to base64
 * @returns {string} A base64-encoded string representation of the hexadecimal string
 */
const hexToBase64 = (hexStr) => {
    hexStr = hexStr.padStart(hexStr.length + (hexStr.length % 2), "0");
    const bytes = hexStr.match(/.{2}/g).map(byte => parseInt(byte, 16));

    return btoa(String.fromCharCode(...bytes));
}

/**
 * Converts a BigInt to Base64-encoded string
 * @function bigintToBase64
 * @param {BigInt} bigint - The bigInt to convert to base64
 * @returns {string} A base64-encoded string representation of the BigInt
 */
const bigintToBase64 = (bigint) => {
    const hexStr = bigint.toString(16);
    const hexPairs = hexStr.match(/\w{2}/g);
    const bytes = hexPairs.map(pair => parseInt(pair, 16));
    const byteString = String.fromCharCode(...bytes);
    const base64 = btoa(byteString);
    const formatedBase64 = base64.match(/.{1,76}/g).join('\n');

    return formatedBase64;
}

/**
 * Converts an hexadecimal string to Base64-encoded string
 * @function getRandomNumber
 * @param {number} min - The min number of the range
 * @param {number} max - The max number of the range
 * @returns {number} A random number between min and max included
 */
const getRandomNumber = (min = 100000, max = 999999) => {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Signs a XML using a provided P12 file and return the signed XML string
 * @async
 * @function sign
 * @param {string} p12Path - The file path of the .p12 certificate file
 * @param {string} p12Password - The password of the .p12 certificate file
 * @param {string} xmlString - The XML represented as a string
 * @returns {string} The XML string with a XAdES-BES signature added to it
 */
const sign =  (p12Path, p12Password, xmlString = '') => {

    var keyFile = fs.readFileSync(p12Path);
    var keyBase64 = keyFile.toString('base64');
    // console.log(keyFile, keyBase64)

    var p12Der = forge.util.decode64(keyBase64);

    var p12Asn1 = forge.asn1.fromDer(p12Der);

    var p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

    // console.log(p12);

    const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    // console.log(forge.pki.oids.pkcs8ShroudedKeyBag);
    // console.log(pkcs8Bags);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    // console.log(forge.pki.oids.certBag);
    // console.log(certBags);

    const certBag = certBags[forge.oids.certBag];
    // console.log(forge.oids.certBag)
    // console.log(certBag);

    const friendlyName = certBag[1].attributes.friendlyName[0];
    // console.log(friendlyName);

    let certificate;
    let pkcs8;
    let issuerName = '';

    const cert = certBag.reduce((prev, curr) => curr.cert.extensions.length > prev.cert.extensions.length ? curr : prev);

    const issuerAttrs = cert.cert.issuer.attributes;

    issuerName = issuerAttrs
        .reverse()
        .map(attr => `${attr.shortName}=${attr.value}`)
        .join(", ",);

    // console.log(issuerName);

    if (/BANCO CENTRAL/i.test(friendlyName)) {
        let keys = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag];

        for (let i = 0; i < keys.length; i++) {
            const element = keys[i];

            let friendlyName = element.attributes.friendlyName[0];
            if (/Signing Key/i.test(friendlyName)) {
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

    // console.log(notBefore, notAfter)

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

    // const sha1_signedProperties = sha1ToBase64('<etsi:SignedProperties ' + namespaces);

    // const signature = `
    //     <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
    //         xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#" Id="Signature${signatureNumber}">

    //         <ds:SignedInfo Id="Signature-SignedInfo${signedInfoNumber}">
    //             <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>
    //             <ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></ds:SignatureMethod>
    //             <ds:Reference Id="SignedPropertiesID${signedPropertiesIdNumber}"
    //                 Type="http://uri.etsi.org/01903#SignedProperties"
    //                 URI="#Signature${signatureNumber}-SignedProperties${signedPropertiesNumber}">
    //                 <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
    //                 <ds:DigestValue>
    //                     <!-- HASH O DIGEST DEL ELEMENTO <etsi:SignedProperties> -->
    //                     ${sha1_signedProperties}
    //                 </ds:DigestValue>
    //             </ds:Reference>
    //             <ds:Reference URI="#Certificate${certificateNumber}">
    //                 <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
    //                 <ds:DigestValue>
    //                     <!-- HASH O DIGEST DEL CERTIFICADO X509  -->
    //                     ${hash_certificateX509_der}
    //                 </ds:DigestValue>
    //             </ds:Reference>
    //             <ds:Reference Id="Reference-ID-${referenceIdNumber}" URI="#comprobante">
    //                 <ds:Transforms>
    //                     <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>
    //                 </ds:Transforms>
    //                 <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
    //                 <ds:DigestValue>
    //                     <!-- HASH O DIGEST DE TODO EL ARCHIVO XML IDENTIFICADO POR EL id=”comprobante” -->
    //                     ${sha1_xml}
    //                 </ds:DigestValue>
    //             </ds:Reference>
    //         </ds:SignedInfo>
    //         <ds:SignatureValue Id="SignatureValue${signatureValueNumber}">
    //             <!-- VALOR DE LA FIRMA (ENCRIPTADO CON LA LLAVE PRIVADA DEL CERTIFICADO DIGITAL) -->
    //             ${p12Der}
    //         </ds:SignatureValue>
    //         <ds:KeyInfo Id="Certificate${certificateNumber}">
    //             <ds:X509Data>
    //                 <ds:X509Certificate>
    //                     <!-- CERTIFICADO X509 CODIFICADO EN Base64 -->
    //                     ${certificateX509}
    //                 </ds:X509Certificate>
    //             </ds:X509Data>
    //             <ds:KeyValue>
    //                 <ds:RSAKeyValue>
    //                     <ds:Modulus>
    //                         <!-- MODULO DEL CERTIFICADO X509 -->
    //                         ${modulus}
    //                     </ds:Modulus>
    //                     <ds:Exponent>${exponent}</ds:Exponent>
    //                 </ds:RSAKeyValue>
    //             </ds:KeyValue>
    //         </ds:KeyInfo>

    //         <ds:Object Id="Signature${signatureNumber}-Object${objectNumber}">
    //             <etsi:QualifyingProperties Target="#Signature${signatureNumber}">
    //                 <etsi:SignedProperties
    //                     Id="Signature${signatureNumber}-SignedProperties${signedPropertiesNumber}">
    //                     <etsi:SignedSignatureProperties>
    //                         <etsi:SigningTime>${isoDateTime}</etsi:SigningTime>
    //                         <etsi:SigningCertificate>
    //                             <etsi:Cert>
    //                                 <etsi:CertDigest>
    //                                     <ds:DigestMethod
    //                                         Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
    //                                     <ds:DigestValue>${hash_certificateX509_der}
    //                                     </ds:DigestValue>
    //                                 </etsi:CertDigest>
    //                                 <etsi:IssuerSerial>
    //                                     <ds:X509IssuerName>${issuerName}</ds:X509IssuerName>
    //                                     <ds:X509SerialNumber>${certificateX509_serialNumber}</ds:X509SerialNumber>
    //                                 </etsi:IssuerSerial>
    //                             </etsi:Cert>
    //                         </etsi:SigningCertificate>
    //                     </etsi:SignedSignatureProperties>
    //                     <etsi:SignedDataObjectProperties>
    //                         <etsi:DataObjectFormat
    //                             ObjectReference="#Reference-ID-${referenceIdNumber}">
    //                             <etsi:Description>contenido comprobante</etsi:Description>
    //                             <etsi:MimeType>text/xml</etsi:MimeType>
    //                         </etsi:DataObjectFormat>
    //                     </etsi:SignedDataObjectProperties>
    //                 </etsi:SignedProperties>
    //             </etsi:QualifyingProperties>
    //         </ds:Object>
    //     </ds:Signature>
    // `;

    // console.log(signature);
    // return signature;



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


    // console.log(signedProperties);

    const sha1_signedProperties = sha1ToBase64(signedProperties.replace('<etsi:SignedProperties', '<etsi:SignedProperties ' + namespaces));
    // console.log(sha1_signedProperties);

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

    // console.log('XML', xmlString);
}

// P12S.forEach(element => {
//     sign(`cert/${element.filename}`, element.password, '', 'facturaXml');
// });


module.exports = {
    getP12,
    getXml,
    sha1ToBase64,
    hexToBase64,
    bigintToBase64,
    getRandomNumber,
    sign,
}