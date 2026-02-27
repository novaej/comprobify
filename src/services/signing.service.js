const { sign } = require('../../helpers/firmar');
const cryptoService = require('./crypto.service');

function signXml(xmlString, certPath, certPasswordEnc) {
  let password;

  if (certPasswordEnc) {
    password = cryptoService.decrypt(certPasswordEnc);
  } else {
    throw new Error('Certificate password not configured');
  }

  return sign(certPath, password, xmlString);
}

module.exports = { signXml };
