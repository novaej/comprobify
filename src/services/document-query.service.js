const documentModel = require('../models/document.model');
const NotFoundError = require('../errors/not-found-error');
const { formatDocument } = require('../presenters/document.presenter');

async function getByAccessKey(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) return null;
  return formatDocument(document);
}

async function getXml(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const xml = document.authorization_xml || document.signed_xml;
  return { xml, contentType: 'application/xml' };
}

module.exports = { getByAccessKey, getXml };
