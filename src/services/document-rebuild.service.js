const moment = require('moment');
const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const signingService = require('./signing.service');
const xmlValidator = require('./xml-validator.service');
const { getBuilder } = require('../builders');
const NotFoundError = require('../errors/not-found-error');
const ValidationError = require('../errors/validation-error');
const DocumentStatus = require('../constants/document-status');
const { assertTransition } = require('../constants/document-state-machine');
const EventType = require('../constants/event-type');
const { formatDocument } = require('../presenters/document.presenter');

const DOCUMENT_TYPE_INVOICE = '01';

async function rebuild(accessKey, body, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.SIGNED);

  // Preserve the original issue date, access key, and sequential — only the
  // invoice content (taxes, items, buyer, payments) is corrected by the caller
  const issueDate = moment(document.issue_date).format('DD/MM/YYYY');

  const builder = getBuilder(DOCUMENT_TYPE_INVOICE, issuer);
  const unsignedXml = builder.build({ ...body, issueDate }, document.access_key, document.sequential);

  const paymentsTotal = parseFloat(
    body.payments.reduce((sum, p) => sum + parseFloat(p.total), 0).toFixed(2)
  );
  if (paymentsTotal !== parseFloat(builder.total)) {
    throw new ValidationError([
      `payments total (${paymentsTotal.toFixed(2)}) does not match invoice total (${builder.total})`,
    ]);
  }

  const xsdResult = await xmlValidator.validate(unsignedXml);
  if (!xsdResult.valid) {
    throw new ValidationError(xsdResult.errors);
  }

  const signedXml = signingService.signXml(unsignedXml, issuer.encrypted_private_key, issuer.certificate_pem);

  const updated = await documentModel.updateStatus(document.id, DocumentStatus.SIGNED, {
    unsigned_xml: unsignedXml,
    signed_xml: signedXml,
    request_payload: JSON.stringify(body),
    subtotal: builder.subtotal,
    total: builder.total,
    buyer_id: body.buyer.id,
    buyer_name: body.buyer.name,
    buyer_id_type: body.buyer.idType,
  });

  await documentEventModel.create(document.id, EventType.REBUILT, document.status, DocumentStatus.SIGNED, {});

  return formatDocument(updated);
}

module.exports = { rebuild };
