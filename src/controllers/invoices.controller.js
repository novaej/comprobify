const documentCreation = require('../services/document-creation.service');
const documentTransmission = require('../services/document-transmission.service');
const documentRebuild = require('../services/document-rebuild.service');
const documentEmail = require('../services/document-email.service');
const documentQuery = require('../services/document-query.service');
const rideService = require('../services/ride.service');
const NotFoundError = require('../errors/not-found-error');

const create = async (req, res) => {
  const { document, created } = await documentCreation.create(req.body, req.idempotencyKey, req.issuer);
  res.status(created ? 201 : 200).json({ ok: true, document });
};

const getByAccessKey = async (req, res) => {
  const document = await documentQuery.getByAccessKey(req.params.accessKey, req.issuer);
  if (!document) {
    throw new NotFoundError('Document');
  }
  res.json({ ok: true, document });
};

const sendToSri = async (req, res) => {
  const result = await documentTransmission.sendToSri(req.params.accessKey, req.issuer);
  res.json({ ok: true, document: result });
};

const checkAuthorization = async (req, res) => {
  const result = await documentTransmission.checkAuthorization(req.params.accessKey, req.issuer);
  res.json({ ok: true, document: result });
};

const rebuild = async (req, res) => {
  const result = await documentRebuild.rebuild(req.params.accessKey, req.body, req.issuer);
  res.json({ ok: true, document: result });
};

const getRide = async (req, res) => {
  const buffer = await rideService.generate(req.params.accessKey, req.issuer);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="RIDE-${req.params.accessKey}.pdf"`);
  res.send(buffer);
};

const retryEmails = async (req, res) => {
  const result = await documentEmail.retryFailedEmails(req.issuer);
  res.json({ ok: true, result });
};

const retrySingleEmail = async (req, res) => {
  const force = req.query.force === 'true';
  const result = await documentEmail.retrySingleEmail(req.params.accessKey, { force }, req.issuer);
  res.json({ ok: true, result });
};

const getXml = async (req, res) => {
  const { xml } = await documentQuery.getXml(req.params.accessKey, req.issuer);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.accessKey}.xml"`);
  res.send(xml);
};

module.exports = { create, getByAccessKey, sendToSri, checkAuthorization, rebuild, getRide, retryEmails, retrySingleEmail, getXml };
