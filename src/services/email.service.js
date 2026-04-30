const issuerModel = require('../models/issuer.model');
const rideService = require('./ride.service');
const emailFactory = require('./email');
const invoiceAuthorizedTemplate = require('./email/templates/invoice-authorized');
const verifyEmailTemplate = require('./email/templates/verify-email');
const config = require('../config');

/**
 * Generate and send the authorized invoice email with RIDE PDF and XML attached.
 * Returns { sent: true } on success, { sent: false, reason } if skipped.
 * Throws on provider error — callers decide how to handle.
 *
 * @param {object} document - DB row from documents table
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendInvoiceAuthorized(document) {
  if (!document.buyer_email) {
    return { sent: false, reason: 'no_email' };
  }

  const issuer = await issuerModel.findById(document.issuer_id);
  const ridePdf  = await rideService.generate(document);
  const xmlBytes = Buffer.from(document.authorization_xml, 'utf8');

  const { subject, text, html } = invoiceAuthorizedTemplate.render(document, issuer);
  const provider = emailFactory.getProvider();

  const from = `${issuer.business_name} via Comprobify <${config.email.from}>`;

  const { messageId } = await provider.send({
    from,
    to: document.buyer_email,
    subject,
    text,
    html,
    attachments: [
      { filename: `RIDE-${document.access_key}.pdf`, data: ridePdf,  contentType: 'application/pdf' },
      { filename: `${document.access_key}.xml`,      data: xmlBytes, contentType: 'application/xml' },
    ],
  });

  return { sent: true, messageId };
}

async function sendVerificationEmail(email, token, redirectUrl = null) {
  const verificationUrl = redirectUrl
    ? `${redirectUrl}?token=${token}`
    : `${config.appBaseUrl}/api/verify-email?token=${token}`;
  const { subject, text, html } = verifyEmailTemplate.render(verificationUrl, config.verificationTokenTtlHours);
  const provider = emailFactory.getProvider();

  const { messageId } = await provider.send({
    from: `Comprobify <${config.email.from}>`,
    to: email,
    subject,
    text,
    html,
    attachments: [],
  });

  return { messageId };
}

module.exports = { sendInvoiceAuthorized, sendVerificationEmail };
