const crypto = require('crypto');
const moment = require('moment');
const db = require('../config/database');
const documentModel = require('../models/document.model');
const documentLineItemModel = require('../models/document-line-item.model');
const documentEventModel = require('../models/document-event.model');
const sequentialService = require('./sequential.service');
const accessKeyService = require('./access-key.service');
const signingService = require('./signing.service');
const xmlValidator = require('./xml-validator.service');
const { getBuilder } = require('../builders');
const ValidationError = require('../errors/validation-error');
const ConflictError = require('../errors/conflict-error');
const DocumentStatus = require('../constants/document-status');
const EventType = require('../constants/event-type');
const { formatDocument } = require('../presenters/document.presenter');

const DEFAULT_DOCUMENT_TYPE = '01';

function hashPayload(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function create(body, idempotencyKey = null, issuer) {
  if (idempotencyKey) {
    const existing = await documentModel.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (hashPayload(body) !== existing.payload_hash) {
        throw new ConflictError(
          'Idempotency-Key reuse: the request body does not match the original request'
        );
      }
      return { document: formatDocument(existing), created: false };
    }
  }

  const payloadHash = idempotencyKey ? hashPayload(body) : null;

  const documentType = body.documentType || DEFAULT_DOCUMENT_TYPE;
  const issueDate = body.issueDate || moment().format('DD/MM/YYYY');

  // Open a single transaction that covers sequential assignment, XML build/validate/sign,
  // and all INSERTs. If anything fails the entire transaction rolls back — the sequential
  // is never committed and can be reused by the next request.
  // The sequential is only consumed once the document row is persisted and committed.
  const client = await db.getClient();

  let document;
  try {
    await client.query('BEGIN');

    // Get next sequential within this transaction (FOR UPDATE, not yet committed)
    const sequential = await sequentialService.getNext(
      issuer.id,
      issuer.branch_code,
      issuer.issue_point_code,
      documentType,
      client
    );

    // Generate 49-digit SRI access key
    const accessKey = await accessKeyService.generate({
      issueDate,
      documentType: documentType,
      ruc: issuer.ruc,
      environment: issuer.environment,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      sequential,
      emissionType: issuer.emission_type,
    });

    // Build XML
    const builder = getBuilder(documentType, issuer);
    const unsignedXml = builder.build({ ...body, issueDate }, accessKey, sequential);

    // Validate that payments sum matches the calculated invoice total
    const paymentsTotal = parseFloat(
      body.payments.reduce((sum, p) => sum + parseFloat(p.total), 0).toFixed(2)
    );
    if (paymentsTotal !== parseFloat(builder.total)) {
      throw new ValidationError([
        `payments total (${paymentsTotal.toFixed(2)}) does not match invoice total (${builder.total})`,
      ]);
    }

    // Validate against XSD — throws ValidationError if invalid, rolls back transaction
    const xsdResult = await xmlValidator.validate(unsignedXml);
    if (!xsdResult.valid) {
      throw new ValidationError(xsdResult.errors);
    }

    // Sign XML — throws if certificate is expired or invalid, rolls back transaction
    const signedXml = signingService.signXml(unsignedXml, issuer.cert_path, issuer.cert_password_enc);

    // Prefer buyer.email from payload, fall back to additionalInfo for backward compat
    const buyerEmail = body.buyer.email
      || (body.additionalInfo || []).find(f => f.name.toLowerCase() === 'email')?.value
      || null;

    // Save document within the same transaction
    document = await documentModel.create({
      issuerId: issuer.id,
      documentType: documentType,
      accessKey,
      sequential,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      issueDate: moment(issueDate, 'DD/MM/YYYY').toDate(),
      status: DocumentStatus.SIGNED,
      unsignedXml,
      signedXml,
      buyerId: body.buyer.id,
      buyerName: body.buyer.name,
      buyerIdType: body.buyer.idType,
      subtotal: builder.subtotal,
      total: builder.total,
      requestPayload: body,
      buyerEmail,
      idempotencyKey,
      payloadHash,
    }, client);

    // Persist invoice line items within the same transaction
    await documentLineItemModel.bulkCreate(document.id, body.items, client);

    // Log audit event within the same transaction
    await documentEventModel.create(document.id, EventType.CREATED, null, DocumentStatus.SIGNED, {
      accessKey,
      sequential,
    }, client);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Two concurrent requests with the same idempotency key — the second one lost the
    // race to the UNIQUE index. Fetch the winner and return it as a replay.
    if (idempotencyKey && err.code === '23505') {
      const winner = await documentModel.findByIdempotencyKey(idempotencyKey);
      if (winner) return { document: formatDocument(winner), created: false };
    }
    throw err;
  } finally {
    client.release();
  }

  return { document: formatDocument(document), created: true };
}

module.exports = { create, hashPayload };
