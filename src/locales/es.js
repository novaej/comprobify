module.exports = {
  email: {
    invoiceAuthorized: {
      subject: (formattedSeq, issuerName) => `Factura Electrónica N° ${formattedSeq} — ${issuerName}`,
      greeting: (buyerName) => `Estimado/a ${buyerName},`,
      intro: 'Nos complacemos en informarle que su comprobante electrónico ha sido autorizado por el SRI.',
      labelInvoiceNumber: 'Factura N°',
      labelIssueDate: 'Fecha de emisión',
      labelTotal: 'Total',
      labelAuthorizationNumber: 'Número de autorización',
      attachmentsIntro: 'Adjunto encontrará los siguientes documentos:',
      attachmentRide: 'Representación impresa del comprobante',
      attachmentXml: 'Comprobante electrónico (XML autorizado)',
      thanks: 'Gracias por su preferencia.',
      ruc: (issuerRuc) => `RUC: ${issuerRuc}`,
      disclaimer: 'No responder — este es un mensaje automático.',
    },
    verifyEmail: {
      subject: 'Verifica tu correo electrónico de Comprobify',
      greeting: '¡Bienvenido a Comprobify!',
      cta: 'Verifica tu correo electrónico para activar tu cuenta. También necesitarás una cuenta activa para habilitar la facturación en producción:',
      expiry: (ttlLabel) => `Este enlace expira en ${ttlLabel}.`,
      ttlLabel: (hours) => hours === 1 ? '1 hora' : `${hours} horas`,
      disclaimer: 'Si no te registraste en Comprobify, puedes ignorar este correo.',
    },
  },
};
