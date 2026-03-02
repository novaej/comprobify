const { sign } = require('../../helpers/signer');
const cryptoService = require('./crypto.service');

function signXml(xmlString, encryptedPrivateKey, certPem) {
  const privateKeyPem = cryptoService.decrypt(encryptedPrivateKey);
  return sign(privateKeyPem, certPem, xmlString);
}

module.exports = { signXml };
