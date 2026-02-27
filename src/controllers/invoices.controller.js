const documentService = require('../services/document.service');
const NotFoundError = require('../errors/not-found-error');

const create = async (req, res) => {
  const document = await documentService.create(req.body);
  res.status(201).json({ ok: true, document });
};

const getByAccessKey = async (req, res) => {
  const document = await documentService.getByAccessKey(req.params.accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  res.json({ ok: true, document });
};

const sendToSri = async (req, res) => {
  const result = await documentService.sendToSri(req.params.accessKey);
  res.json({ ok: true, document: result });
};

const checkAuthorization = async (req, res) => {
  const result = await documentService.checkAuthorization(req.params.accessKey);
  res.json({ ok: true, document: result });
};

module.exports = { create, getByAccessKey, sendToSri, checkAuthorization };
