const documentService = require('../services/document.service');
const rideService = require('../services/ride.service');
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

const rebuild = async (req, res) => {
  const result = await documentService.rebuild(req.params.accessKey, req.body);
  res.json({ ok: true, document: result });
};

const getRide = async (req, res) => {
  const buffer = await rideService.generate(req.params.accessKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="RIDE-${req.params.accessKey}.pdf"`);
  res.send(buffer);
};

const retryEmails = async (req, res) => {
  const result = await documentService.retryFailedEmails();
  res.json({ ok: true, result });
};

const retrySingleEmail = async (req, res) => {
  const result = await documentService.retrySingleEmail(req.params.accessKey);
  res.json({ ok: true, result });
};

const getXml = async (req, res) => {
  const { xml } = await documentService.getXml(req.params.accessKey);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.accessKey}.xml"`);
  res.send(xml);
};

module.exports = { create, getByAccessKey, sendToSri, checkAuthorization, rebuild, getRide, retryEmails, retrySingleEmail, getXml };
