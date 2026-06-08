module.exports = {
  email: {
    invoiceAuthorized: {
      subject: (formattedSeq, issuerName) => `Electronic Invoice No. ${formattedSeq} — ${issuerName}`,
      greeting: (buyerName) => `Dear ${buyerName},`,
      intro: 'We are pleased to inform you that your electronic receipt has been authorized by the SRI.',
      labelInvoiceNumber: 'Invoice No.',
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
      disclaimer: 'If you did not sign up for Comprobify, you can ignore this email.',
    },
  },
};
