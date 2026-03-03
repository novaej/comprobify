const issuerModel = require('../models/issuer.model');
const rideService = require('./ride.service');
const emailFactory = require('./email');
const template = require('./email/templates/invoice-authorized');

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

  const { subject, text, html } = template.render(document, issuer);
  const provider = emailFactory.getProvider();

  const { messageId } = await provider.send({
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

module.exports = { sendInvoiceAuthorized };
