const moment = require('moment');
const { generateAccessKey } = require('../../helpers/access-key-generator');

async function generate({ issueDate, documentType, ruc, environment, branchCode, issuePointCode, sequential, emissionType }) {
  const dateMoment = moment(issueDate, 'DD/MM/YYYY');
  const invoiceNumber = `${branchCode}${issuePointCode}${String(sequential).padStart(9, '0')}`;
  const numericCode = String(sequential).padStart(8, '0');

  return generateAccessKey(dateMoment, ruc, documentType, environment, emissionType || '1', invoiceNumber, numericCode);
}

module.exports = { generate };
