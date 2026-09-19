module.exports = {
  email: {
    invoiceAuthorized: {
      documentTypeLabels: { '01': 'Factura', '04': 'Nota de Crédito' },
      subject: (docTypeLabel, formattedSeq, issuerName) => `${docTypeLabel} Electrónica N° ${formattedSeq} — ${issuerName}`,
      greeting: (buyerName) => `Estimado/a ${buyerName},`,
      intro: 'Nos complacemos en informarle que su comprobante electrónico ha sido autorizado por el SRI.',
      labelInvoiceNumber: (docTypeLabel) => `${docTypeLabel} N°`,
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
      disclaimer: 'Si no te registraste en Comprobify, puedes ignorar este correo. No respondas — este es un mensaje automático.',
      // Se envía en lugar del mensaje de bienvenida tras POST /v1/recover — es un aviso de seguridad.
      recovery: {
        subject: 'Tu cuenta de Comprobify fue recuperada — confirma tu correo',
        greeting: 'Tu cuenta de Comprobify acaba de ser recuperada',
        cta: 'Se recuperó el acceso a tu cuenta usando su certificado de firma, y se reemplazaron las llaves de API de tu ambiente actual. Si fuiste tú, confirma tu correo electrónico para restablecer el acceso completo (nuevas sucursales, llaves de API, webhooks y suscripciones):',
        disclaimer: 'Si NO fuiste tú, no hagas clic en el enlace — alguien podría tener tu certificado. Contacta de inmediato al soporte de Comprobify. No respondas — este es un mensaje automático.',
        contact: (email) => `Soporte: ${email}`,
      },
    },
    // paymentVerified/paymentRejected/subscriptionRenewalDue/
    // subscriptionExpired/priceChangeAnnounced removed (ADR-024 Phase C) —
    // those 5 notification types now render
    // from notification_email_templates (DB, versioned), not this locale
    // file. See docs/email-templates/*.txt for their content.
  },
};
