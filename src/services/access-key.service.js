const crypto = require('crypto');
const moment = require('moment');
const { generateAccessKey } = require('../../helpers/access-key-generator');

async function generate({ issueDate, documentType, ruc, environment, branchCode, issuePointCode, sequential, emissionType }) {
  const dateMoment = moment(issueDate, 'DD/MM/YYYY');
  const invoiceNumber = `${branchCode}${issuePointCode}${String(sequential).padStart(9, '0')}`;
  // SRI: numeric code is a security mechanism chosen freely by the issuer.
  // A cryptographically random 8-digit number makes it unpredictable.
  const numericCode = String(crypto.randomInt(10000000, 100000000));

  return generateAccessKey(dateMoment, ruc, documentType, environment, emissionType || '1', invoiceNumber, numericCode);
}

module.exports = { generate };
