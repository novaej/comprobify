const issuerModel = require('../models/issuer.model');
const tenantModel = require('../models/tenant.model');
const rideService = require('./ride.service');
const emailFactory = require('./email');
const invoiceAuthorizedTemplate = require('./email/templates/invoice-authorized');
const verifyEmailTemplate = require('./email/templates/verify-email');
const paymentProofSubmittedTemplate = require('./email/templates/payment-proof-submitted');
const paymentReviewedTemplate = require('./email/templates/payment-reviewed');
const subscriptionRenewalDueTemplate = require('./email/templates/subscription-renewal-due');
const subscriptionExpiredTemplate = require('./email/templates/subscription-expired');
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
  const tenant = await tenantModel.findById(issuer.tenant_id);
  const ridePdf  = await rideService.generate(document);
  const xmlBytes = Buffer.from(document.authorization_xml, 'utf8');

  const { subject, text, html } = invoiceAuthorizedTemplate.render(document, issuer, tenant.preferred_language || 'es');
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

async function sendVerificationEmail(email, token, redirectUrl = null, language = 'es') {
  const verificationUrl = redirectUrl
    ? `${redirectUrl}?token=${token}`
    : `${config.appBaseUrl}/v1/verify-email?token=${token}`;
  const { subject, text, html } = verifyEmailTemplate.render(verificationUrl, config.verificationTokenTtlHours, language);
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

/**
 * Notify the operator that a tenant uploaded payment proof needing review.
 * Skipped entirely (no-op) if ADMIN_NOTIFICATION_EMAIL is unset — this is an
 * operational convenience email, not something tenant-facing behavior depends on.
 *
 * @param {object} payment      - DB row from payments table
 * @param {object} subscription - DB row from subscriptions table
 * @param {object} tenant       - DB row from tenants table
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendPaymentProofSubmitted(payment, subscription, tenant) {
  if (!config.adminNotificationEmail) {
    return { sent: false, reason: 'no_admin_email' };
  }

  const { subject, text, html } = paymentProofSubmittedTemplate.render(payment, subscription, tenant);
  const provider = emailFactory.getProvider();

  await provider.send({
    from: `Comprobify <${config.email.from}>`,
    to: config.adminNotificationEmail,
    subject,
    text,
    html,
    attachments: [],
  });

  return { sent: true };
}

/**
 * Tell the tenant their payment proof was verified or rejected.
 *
 * @param {object} payment      - DB row from payments table
 * @param {object} subscription - DB row from subscriptions table
 * @param {'VERIFIED'|'REJECTED'} decision
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendPaymentReviewed(payment, subscription, decision) {
  const tenant = await tenantModel.findById(subscription.tenant_id);
  const { subject, text, html } = paymentReviewedTemplate.render(payment, subscription, decision, tenant.preferred_language || 'es');
  const provider = emailFactory.getProvider();

  await provider.send({
    from: `Comprobify <${config.email.from}>`,
    to: tenant.email,
    subject,
    text,
    html,
    attachments: [],
  });

  return { sent: true };
}

/**
 * Tell the tenant their subscription renews soon and a renewal payment is open.
 *
 * @param {object} subscription - DB row from subscriptions table
 * @param {object} payment      - DB row from payments table (purpose RENEWAL)
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendSubscriptionRenewalDue(subscription, payment) {
  const tenant = await tenantModel.findById(subscription.tenant_id);
  const { subject, text, html } = subscriptionRenewalDueTemplate.render(
    subscription, payment, config.bankTransfer, tenant.preferred_language || 'es'
  );
  const provider = emailFactory.getProvider();

  await provider.send({
    from: `Comprobify <${config.email.from}>`,
    to: tenant.email,
    subject,
    text,
    html,
    attachments: [],
  });

  return { sent: true };
}

/**
 * Tell the tenant their subscription expired (no verified renewal payment
 * before the grace period elapsed) and they've been moved to FREE.
 *
 * @param {object} subscription - DB row from subscriptions table (tier = the tier just lost)
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendSubscriptionExpired(subscription) {
  const tenant = await tenantModel.findById(subscription.tenant_id);
  const { subject, text, html } = subscriptionExpiredTemplate.render(subscription, tenant.preferred_language || 'es');
  const provider = emailFactory.getProvider();

  await provider.send({
    from: `Comprobify <${config.email.from}>`,
    to: tenant.email,
    subject,
    text,
    html,
    attachments: [],
  });

  return { sent: true };
}

module.exports = {
  sendInvoiceAuthorized,
  sendVerificationEmail,
  sendPaymentProofSubmitted,
  sendPaymentReviewed,
  sendSubscriptionRenewalDue,
  sendSubscriptionExpired,
};
