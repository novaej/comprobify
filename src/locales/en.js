module.exports = {
  email: {
    invoiceAuthorized: {
      documentTypeLabels: { '01': 'Invoice', '04': 'Credit Note' },
      subject: (docTypeLabel, formattedSeq, issuerName) => `Electronic ${docTypeLabel} No. ${formattedSeq} — ${issuerName}`,
      greeting: (buyerName) => `Dear ${buyerName},`,
      intro: 'We are pleased to inform you that your electronic receipt has been authorized by the SRI.',
      labelInvoiceNumber: (docTypeLabel) => `${docTypeLabel} No.`,
      labelIssueDate: 'Issue date',
      labelTotal: 'Total',
      labelAuthorizationNumber: 'Authorization number',
      attachmentsIntro: 'Please find attached the following documents:',
      attachmentRide: 'Printed representation of the receipt',
      attachmentXml: 'Electronic receipt (authorized XML)',
      thanks: 'Thank you for your preference.',
      ruc: (issuerRuc) => `RUC: ${issuerRuc}`,
      disclaimer: 'Do not reply — this is an automated message.',
    },
    verifyEmail: {
      subject: 'Verify your Comprobify email address',
      greeting: 'Welcome to Comprobify!',
      cta: 'Verify your email address to activate your account. You will also need an active account to enable production invoicing:',
      expiry: (ttlLabel) => `This link expires in ${ttlLabel}.`,
      ttlLabel: (hours) => hours === 1 ? '1 hour' : `${hours} hours`,
      disclaimer: 'If you did not sign up for Comprobify, you can ignore this email. Do not reply — this is an automated message.',
      // Sent instead of the welcome copy after POST /v1/recover — a security notice, not a greeting.
      recovery: {
        subject: 'Your Comprobify account was recovered — confirm your email',
        greeting: 'Your Comprobify account was just recovered',
        cta: 'Access to your account was recovered using its signing certificate, and the API keys for your current environment were replaced. If this was you, confirm your email address to restore full access (new branches, API keys, webhooks and subscriptions):',
        disclaimer: 'If you did NOT do this, do not click the link — someone may have your certificate. Contact Comprobify support right away. Do not reply — this is an automated message.',
        contact: (email) => `Support: ${email}`,
      },
    },
    // paymentVerified/paymentRejected/subscriptionRenewalDue/
    // subscriptionExpired/priceChangeAnnounced removed (ADR-024 Phase C) —
    // those 5 notification types now render
    // from notification_email_templates (DB, versioned), not this locale
    // file. See docs/email-templates/*.txt for their content.
  },
};
