const crypto = require('crypto');
const moment = require('moment');
const config = require('../config');
const db = require('../config/database');
const issuerModel = require('../models/issuer.model');
const documentModel = require('../models/document.model');
const invoiceDetailModel = require('../models/invoice-detail.model');
const documentEventModel = require('../models/document-event.model');
const clientModel = require('../models/client.model');
const sequentialService = require('./sequential.service');
const accessKeyService = require('./access-key.service');
const signingService = require('./signing.service');
const xmlValidator = require('./xml-validator.service');
const { getBuilder } = require('../builders');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const ValidationError = require('../errors/validation-error');
const ConflictError = require('../errors/conflict-error');
const DocumentStatus = require('../constants/document-status');
const EventType = require('../constants/event-type');
const OperationType = require('../constants/operation-type');
const SriErrorCodes = require('../constants/sri-error-codes');
const emailService = require('./email.service');

const DOCUMENT_TYPE_INVOICE = '01';

function hashPayload(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function getIssuer() {
  const issuer = await issuerModel.findFirst();
  if (!issuer) {
    throw new AppError('No active issuer configured', 500);
  }
  return issuer;
}

async function create(body, idempotencyKey = null) {
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

  const issuer = await getIssuer();
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
      DOCUMENT_TYPE_INVOICE,
      client
    );

    // Generate 49-digit SRI access key
    const accessKey = await accessKeyService.generate({
      issueDate,
      documentType: DOCUMENT_TYPE_INVOICE,
      ruc: issuer.ruc,
      environment: issuer.environment,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      sequential,
      emissionType: issuer.emission_type,
    });

    // Build XML
    const builder = getBuilder(DOCUMENT_TYPE_INVOICE, issuer);
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
    const xsdResult = xmlValidator.validate(unsignedXml);
    if (!xsdResult.valid) {
      throw new ValidationError(xsdResult.errors);
    }

    // Sign XML — throws if certificate is expired or invalid, rolls back transaction
    const signedXml = signingService.signXml(unsignedXml, issuer.cert_path, issuer.cert_password_enc);

    // Extract buyer email from additionalInfo if provided
    const buyerEmail = (body.additionalInfo || [])
      .find(f => f.name.toLowerCase() === 'email')?.value || null;

    // Save document within the same transaction
    document = await documentModel.create({
      issuerId: issuer.id,
      documentType: DOCUMENT_TYPE_INVOICE,
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
    await invoiceDetailModel.bulkCreate(document.id, body.items, client);

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

  // Fire-and-forget buyer upsert — runs after commit, failure never affects the invoice
  clientModel.findOrCreate(issuer.id, body.buyer).catch((err) => {
    console.warn('Failed to upsert client record:', err.message);
  });

  return { document: formatDocument(document), created: true };
}

async function getByAccessKey(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) return null;
  return formatDocument(document);
}

async function sendToSri(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== DocumentStatus.SIGNED) {
    throw new AppError(`Cannot send document with status ${document.status}. Must be ${DocumentStatus.SIGNED}.`, 400);
  }

  const issuer = await issuerModel.findById(document.issuer_id);
  const sriService = require('./sri.service');
  let result;
  try {
    result = await sriService.sendReceipt(document.signed_xml, issuer.environment);
  } catch (err) {
    await documentEventModel.create(document.id, EventType.ERROR, document.status, null, {
      operation: 'SEND',
      message: err.message,
    });
    throw err;
  }

  const sriResponseModel = require('../models/sri-response.model');
  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.RECEPTION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  const newStatus = result.status === 'RECIBIDA' ? DocumentStatus.RECEIVED : DocumentStatus.RETURNED;
  const updated = await documentModel.updateStatus(document.id, newStatus);

  await documentEventModel.create(document.id, EventType.SENT, document.status, newStatus, {
    sriStatus: result.status,
  });

  return formatDocument(updated);
}

async function checkAuthorization(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== DocumentStatus.RECEIVED) {
    throw new AppError(
      `Cannot check authorization for document with status ${document.status}. Must be ${DocumentStatus.RECEIVED}.`,
      400
    );
  }

  const issuer = await issuerModel.findById(document.issuer_id);
  const sriService = require('./sri.service');
  let result;
  try {
    result = await sriService.checkAuthorization(accessKey, issuer.environment);
  } catch (err) {
    await documentEventModel.create(document.id, EventType.ERROR, document.status, null, {
      operation: 'AUTHORIZE',
      message: err.message,
    });
    throw err;
  }

  const sriResponseModel = require('../models/sri-response.model');
  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.AUTHORIZATION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  if (result.pending) {
    return formatDocument(document);
  }

  const newStatus = result.status === 'AUTORIZADO' ? DocumentStatus.AUTHORIZED : DocumentStatus.NOT_AUTHORIZED;
  const statusChanged = newStatus !== document.status;

  let updated = document;

  if (statusChanged) {
    const extraFields = {};
    if (newStatus === DocumentStatus.AUTHORIZED) {
      if (result.authorizationNumber) extraFields.authorization_number = result.authorizationNumber;
      if (result.authorizationDate)   extraFields.authorization_date   = result.authorizationDate;
      if (result.authorizationXml)    extraFields.authorization_xml    = result.authorizationXml;
    }

    updated = await documentModel.updateStatus(document.id, newStatus, extraFields);

    await documentEventModel.create(document.id, EventType.STATUS_CHANGED, document.status, newStatus, {
      sriStatus: result.status,
      authorizationNumber: result.authorizationNumber || null,
    });

    if (newStatus === DocumentStatus.AUTHORIZED) {
      emailService.sendInvoiceAuthorized(updated)
        .then(({ sent }) => {
          const emailFields = sent
            ? { email_status: 'SENT', email_sent_at: new Date() }
            : { email_status: 'SKIPPED' };
          return Promise.all([
            documentModel.updateStatus(updated.id, updated.status, emailFields),
            documentEventModel.create(updated.id,
              sent ? EventType.EMAIL_SENT : EventType.EMAIL_FAILED,
              null, null, { to: updated.buyer_email }),
          ]);
        })
        .catch(err => {
          console.warn('Invoice email failed:', err.message);
          Promise.all([
            documentModel.updateStatus(updated.id, updated.status, {
              email_status: 'FAILED',
              email_error: err.message,
            }),
            documentEventModel.create(updated.id, EventType.EMAIL_FAILED,
              null, null, { error: err.message }),
          ]).catch(() => {});
        });
    }
  }

  return formatDocument(updated);
}

async function rebuild(accessKey, body) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const rebuildableStatuses = [DocumentStatus.RETURNED, DocumentStatus.NOT_AUTHORIZED];
  if (!rebuildableStatuses.includes(document.status)) {
    throw new AppError(
      `Cannot rebuild document with status ${document.status}. Must be ${rebuildableStatuses.join(' or ')}.`,
      400
    );
  }

  const issuer = await issuerModel.findById(document.issuer_id);

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

  const xsdResult = xmlValidator.validate(unsignedXml);
  if (!xsdResult.valid) {
    throw new ValidationError(xsdResult.errors);
  }

  const signedXml = signingService.signXml(unsignedXml, issuer.cert_path, issuer.cert_password_enc);

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

async function retryFailedEmails() {
  const documents = await documentModel.findPendingEmails();
  const result = { sent: 0, failed: 0 };

  for (const doc of documents) {
    try {
      await emailService.sendInvoiceAuthorized(doc);
      await documentModel.updateStatus(doc.id, doc.status, {
        email_status: 'SENT',
        email_sent_at: new Date(),
        email_error: null,
      });
      await documentEventModel.create(doc.id, EventType.EMAIL_SENT,
        null, null, { to: doc.buyer_email, retried: true });
      result.sent++;
    } catch (err) {
      await documentModel.updateStatus(doc.id, doc.status, {
        email_status: 'FAILED',
        email_error: err.message,
      });
      await documentEventModel.create(doc.id, EventType.EMAIL_FAILED,
        null, null, { error: err.message, retried: true });
      result.failed++;
    }
  }

  return result;
}

async function retrySingleEmail(accessKey, { force = false } = {}) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== DocumentStatus.AUTHORIZED) {
    throw new AppError(`Cannot send email for document with status ${document.status}. Must be ${DocumentStatus.AUTHORIZED}.`, 400);
  }
  if (!document.buyer_email) {
    await documentModel.updateStatus(document.id, document.status, { email_status: 'SKIPPED' });
    return { sent: false, reason: 'no_email' };
  }
  if (document.email_status === 'SENT' && !force) {
    return { sent: false, reason: 'already_sent' };
  }

  try {
    await emailService.sendInvoiceAuthorized(document);
    await documentModel.updateStatus(document.id, document.status, {
      email_status: 'SENT',
      email_sent_at: new Date(),
      email_error: null,
    });
    await documentEventModel.create(document.id, EventType.EMAIL_SENT,
      null, null, { to: document.buyer_email, retried: true });
    return { sent: true };
  } catch (err) {
    await documentModel.updateStatus(document.id, document.status, {
      email_status: 'FAILED',
      email_error: err.message,
    });
    await documentEventModel.create(document.id, EventType.EMAIL_FAILED,
      null, null, { error: err.message, retried: true });
    throw err;
  }
}

async function getXml(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const xml = document.authorization_xml || document.signed_xml;
  return { xml, contentType: 'application/xml' };
}

function formatDocument(doc) {
  return {
    accessKey: doc.access_key,
    sequential: String(doc.sequential).padStart(9, '0'),
    status: doc.status,
    issueDate: moment(doc.issue_date).format('DD/MM/YYYY'),
    total: doc.total,
    ...(doc.authorization_number && { authorizationNumber: doc.authorization_number }),
    ...(doc.authorization_date && { authorizationDate: doc.authorization_date }),
    email: {
      status: doc.email_status || 'PENDING',
      ...(doc.email_sent_at && { sentAt: doc.email_sent_at }),
      ...(doc.email_error && { error: doc.email_error }),
    },
  };
}

module.exports = { create, getByAccessKey, sendToSri, checkAuthorization, rebuild, retryFailedEmails, retrySingleEmail, getXml };
