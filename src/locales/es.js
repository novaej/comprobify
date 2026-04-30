module.exports = {
  email: {
    verifyEmail: {
      subject: 'Verifica tu correo electrónico de Comprobify',
      greeting: '¡Bienvenido a Comprobify!',
      cta: 'Verifica tu correo electrónico para habilitar la facturación en producción:',
      expiry: (ttlLabel) => `Este enlace expira en ${ttlLabel}.`,
      ttlLabel: (hours) => hours === 1 ? '1 hora' : `${hours} horas`,
      disclaimer: 'Si no te registraste en Comprobify, puedes ignorar este correo.',
    },
  },
};
