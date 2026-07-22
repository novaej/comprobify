import { defineConfig } from 'vitepress'

// Sidebar/nav structure is identical in both languages — only labels and
// link prefixes differ. Keep them as functions so a future endpoint only
// has to be added once per language, in the same relative shape.

function esSidebar() {
  return [
    { text: 'Resumen', link: '/' },
    { text: 'Primeros Pasos', link: '/getting-started' },
    {
      text: 'Endpoints',
      collapsed: false,
      items: [
        { text: 'Resumen', link: '/endpoints/' },
        {
          text: 'Registro',
          collapsed: false,
          items: [
            { text: 'Registrarse', link: '/endpoints/register' },
            { text: 'Recuperar cuenta', link: '/endpoints/recover' },
            { text: 'Verificar correo', link: '/endpoints/verify-email' },
            { text: 'Reenviar verificación', link: '/endpoints/resend-verification' },
          ],
        },
        {
          text: 'Acuerdos legales',
          collapsed: false,
          items: [
            { text: 'Acuerdos (público)', link: '/endpoints/agreements' },
            { text: 'Aceptación de acuerdos', link: '/endpoints/agreement-acceptance' },
            { text: 'Acuerdos del tenant', link: '/endpoints/tenant-agreements' },
          ],
        },
        {
          text: 'Planes',
          collapsed: false,
          items: [
            { text: 'Consultar planes', link: '/endpoints/get-tiers' },
          ],
        },
        {
          text: 'Pagos',
          collapsed: false,
          items: [
            { text: 'Enviar comprobante de pago', link: '/endpoints/submit-payment-proof' },
            { text: 'Listar comprobantes de pago', link: '/endpoints/list-payment-proofs' },
            { text: 'Descargar comprobante de pago', link: '/endpoints/download-payment-proof' },
            { text: 'Eliminar comprobante de pago', link: '/endpoints/delete-payment-proof' },
          ],
        },
        {
          text: 'Suscripciones',
          collapsed: false,
          items: [
            { text: 'Crear suscripción', link: '/endpoints/create-subscription' },
            { text: 'Consultar mis suscripciones', link: '/endpoints/get-my-subscriptions' },
            { text: 'Cambiar de plan (mejorar/degradar)', link: '/endpoints/change-tier' },
            { text: 'Cancelar suscripción', link: '/endpoints/cancel-subscription' },
          ],
        },
        {
          text: 'Tenants',
          collapsed: false,
          items: [
            { text: 'Consultar tenant actual', link: '/endpoints/tenant-me' },
            { text: 'Actualizar idioma', link: '/endpoints/tenant-language' },
            { text: 'Promover a producción', link: '/endpoints/promote-tenant' },
            { text: 'Historial de eventos del tenant', link: '/endpoints/tenant-events' },
          ],
        },
        {
          text: 'Emisores',
          collapsed: false,
          items: [
            { text: 'Listar emisores', link: '/endpoints/list-issuers' },
            { text: 'Consultar emisor', link: '/endpoints/get-issuer-me' },
            { text: 'Crear sucursal', link: '/endpoints/create-branch' },
            { text: 'Actualizar emisor', link: '/endpoints/update-issuer' },
            { text: 'Eliminar emisor', link: '/endpoints/remove-issuer' },
            { text: 'Activar emisor', link: '/endpoints/activate-issuer' },
            { text: 'Subir logo', link: '/endpoints/upload-issuer-logo' },
            { text: 'Renovar certificado', link: '/endpoints/renew-issuer-certificate' },
            { text: 'Tipos de comprobante', link: '/endpoints/document-types' },
            { text: 'Secuenciales', link: '/endpoints/issuer-sequentials' },
          ],
        },
        {
          text: 'API Keys',
          collapsed: false,
          items: [
            { text: 'Administrar API keys', link: '/endpoints/api-keys' },
          ],
        },
        {
          text: 'Comprobantes',
          collapsed: false,
          items: [
            { text: 'Listar comprobantes', link: '/endpoints/list-documents' },
            { text: 'Estadísticas de comprobantes', link: '/endpoints/document-stats' },
            { text: 'Crear factura', link: '/endpoints/create-invoice' },
            { text: 'Crear nota de crédito', link: '/endpoints/create-credit-note' },
            { text: 'Consultar comprobante', link: '/endpoints/get-document' },
            { text: 'Enviar al SRI', link: '/endpoints/send-to-sri' },
            { text: 'Consultar autorización', link: '/endpoints/check-authorization' },
            { text: 'Reconstruir factura', link: '/endpoints/rebuild-invoice' },
            { text: 'Obtener RIDE (PDF)', link: '/endpoints/get-ride' },
            { text: 'Obtener XML', link: '/endpoints/get-xml' },
            { text: 'Consultar eventos', link: '/endpoints/get-events' },
            { text: 'Respuestas del SRI', link: '/endpoints/get-sri-responses' },
            { text: 'Consultar notas de crédito', link: '/endpoints/get-credit-notes' },
            { text: 'Reintentar correos (lote)', link: '/endpoints/retry-emails' },
            { text: 'Reintentar correo (individual)', link: '/endpoints/retry-single-email' },
          ],
        },
        {
          text: 'Catálogos',
          collapsed: false,
          items: [
            { text: 'Referencia de catálogos', link: '/endpoints/catalogs' },
          ],
        },
        {
          text: 'Notificaciones',
          collapsed: false,
          items: [
            { text: 'Notificaciones', link: '/endpoints/notifications' },
            { text: 'Endpoints de webhook', link: '/endpoints/webhooks' },
          ],
        },
        {
          text: 'Monitoreo',
          collapsed: false,
          items: [
            { text: 'Chequeo de salud', link: '/endpoints/health' },
          ],
        },
      ],
    },
    {
      text: 'Referencia de errores',
      collapsed: false,
      items: [
        { text: 'Formato de error', link: '/errors/' },
        { text: 'Error de validación', link: '/errors/validation-error' },
        { text: 'Solicitud incorrecta', link: '/errors/bad-request' },
        { text: 'No autorizado', link: '/errors/unauthorized' },
        { text: 'Prohibido', link: '/errors/forbidden' },
        { text: 'No encontrado', link: '/errors/not-found' },
        { text: 'Conflicto', link: '/errors/conflict' },
        { text: 'Demasiadas solicitudes', link: '/errors/too-many-requests' },
        { text: 'Envío al SRI fallido', link: '/errors/sri-error' },
        { text: 'Error interno del servidor', link: '/errors/internal-error' },
      ],
    },
  ]
}

function enSidebar() {
  return [
    { text: 'Overview', link: '/en/' },
    { text: 'Getting Started', link: '/en/getting-started' },
    {
      text: 'Endpoints',
      collapsed: false,
      items: [
        { text: 'Overview', link: '/en/endpoints/' },
        {
          text: 'Registration',
          collapsed: false,
          items: [
            { text: 'Register', link: '/en/endpoints/register' },
            { text: 'Recover Account', link: '/en/endpoints/recover' },
            { text: 'Verify Email', link: '/en/endpoints/verify-email' },
            { text: 'Resend Verification', link: '/en/endpoints/resend-verification' },
          ],
        },
        {
          text: 'Agreements',
          collapsed: false,
          items: [
            { text: 'Agreements (Public)', link: '/en/endpoints/agreements' },
            { text: 'Agreement Acceptance', link: '/en/endpoints/agreement-acceptance' },
            { text: 'Tenant Agreements', link: '/en/endpoints/tenant-agreements' },
          ],
        },
        {
          text: 'Tiers',
          collapsed: false,
          items: [
            { text: 'Get Tiers', link: '/en/endpoints/get-tiers' },
          ],
        },
        {
          text: 'Payments',
          collapsed: false,
          items: [
            { text: 'Submit Payment Proof', link: '/en/endpoints/submit-payment-proof' },
            { text: 'List Payment Proofs', link: '/en/endpoints/list-payment-proofs' },
            { text: 'Download Payment Proof', link: '/en/endpoints/download-payment-proof' },
            { text: 'Delete Payment Proof', link: '/en/endpoints/delete-payment-proof' },
          ],
        },
        {
          text: 'Subscriptions',
          collapsed: false,
          items: [
            { text: 'Create Subscription', link: '/en/endpoints/create-subscription' },
            { text: 'Get My Subscriptions', link: '/en/endpoints/get-my-subscriptions' },
            { text: 'Change Tier (Upgrade/Downgrade)', link: '/en/endpoints/change-tier' },
            { text: 'Cancel Subscription', link: '/en/endpoints/cancel-subscription' },
          ],
        },
        {
          text: 'Tenants',
          collapsed: false,
          items: [
            { text: 'Get Current Tenant', link: '/en/endpoints/tenant-me' },
            { text: 'Update Language', link: '/en/endpoints/tenant-language' },
            { text: 'Promote to Production', link: '/en/endpoints/promote-tenant' },
            { text: 'Get Tenant Events', link: '/en/endpoints/tenant-events' },
          ],
        },
        {
          text: 'Issuers',
          collapsed: false,
          items: [
            { text: 'List Issuers', link: '/en/endpoints/list-issuers' },
            { text: 'Get Issuer', link: '/en/endpoints/get-issuer-me' },
            { text: 'Create Branch', link: '/en/endpoints/create-branch' },
            { text: 'Update Issuer', link: '/en/endpoints/update-issuer' },
            { text: 'Remove Issuer', link: '/en/endpoints/remove-issuer' },
            { text: 'Activate Issuer', link: '/en/endpoints/activate-issuer' },
            { text: 'Upload Logo', link: '/en/endpoints/upload-issuer-logo' },
            { text: 'Renew Certificate', link: '/en/endpoints/renew-issuer-certificate' },
            { text: 'Document Types', link: '/en/endpoints/document-types' },
            { text: 'Sequentials', link: '/en/endpoints/issuer-sequentials' },
          ],
        },
        {
          text: 'API Keys',
          collapsed: false,
          items: [
            { text: 'Manage API Keys', link: '/en/endpoints/api-keys' },
          ],
        },
        {
          text: 'Documents',
          collapsed: false,
          items: [
            { text: 'List Documents', link: '/en/endpoints/list-documents' },
            { text: 'Document Stats', link: '/en/endpoints/document-stats' },
            { text: 'Create Invoice', link: '/en/endpoints/create-invoice' },
            { text: 'Create Credit Note', link: '/en/endpoints/create-credit-note' },
            { text: 'Get Document', link: '/en/endpoints/get-document' },
            { text: 'Send to SRI', link: '/en/endpoints/send-to-sri' },
            { text: 'Check Authorization', link: '/en/endpoints/check-authorization' },
            { text: 'Rebuild Invoice', link: '/en/endpoints/rebuild-invoice' },
            { text: 'Get RIDE (PDF)', link: '/en/endpoints/get-ride' },
            { text: 'Get XML', link: '/en/endpoints/get-xml' },
            { text: 'Get Events', link: '/en/endpoints/get-events' },
            { text: 'Get SRI Responses', link: '/en/endpoints/get-sri-responses' },
            { text: 'Get Credit Notes', link: '/en/endpoints/get-credit-notes' },
            { text: 'Retry Emails (Batch)', link: '/en/endpoints/retry-emails' },
            { text: 'Retry Email (Single)', link: '/en/endpoints/retry-single-email' },
          ],
        },
        {
          text: 'Catalogs',
          collapsed: false,
          items: [
            { text: 'Catalog Reference', link: '/en/endpoints/catalogs' },
          ],
        },
        {
          text: 'Notifications',
          collapsed: false,
          items: [
            { text: 'Notifications', link: '/en/endpoints/notifications' },
            { text: 'Webhook Endpoints', link: '/en/endpoints/webhooks' },
          ],
        },
        {
          text: 'Monitoring',
          collapsed: false,
          items: [
            { text: 'Health Check', link: '/en/endpoints/health' },
          ],
        },
      ],
    },
    {
      text: 'Error Reference',
      collapsed: false,
      items: [
        { text: 'Error Format', link: '/en/errors/' },
        { text: 'Validation Error', link: '/en/errors/validation-error' },
        { text: 'Bad Request', link: '/en/errors/bad-request' },
        { text: 'Unauthorized', link: '/en/errors/unauthorized' },
        { text: 'Forbidden', link: '/en/errors/forbidden' },
        { text: 'Not Found', link: '/en/errors/not-found' },
        { text: 'Conflict', link: '/en/errors/conflict' },
        { text: 'Too Many Requests', link: '/en/errors/too-many-requests' },
        { text: 'SRI Submission Failed', link: '/en/errors/sri-error' },
        { text: 'Internal Server Error', link: '/en/errors/internal-error' },
      ],
    },
  ]
}

export default defineConfig({
  title: 'API de Comprobify',
  description: 'API REST para la facturación electrónica del SRI de Ecuador',
  base: '/',
  cleanUrls: true,
  lang: 'es',

  locales: {
    root: {
      label: 'Español',
      lang: 'es',
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      title: 'Comprobify API',
      description: 'REST API for Ecuador SRI electronic invoicing',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Getting Started', link: '/en/getting-started' },
          { text: 'Endpoints', link: '/en/endpoints/' },
          { text: 'Error Reference', link: '/en/errors/' },
        ],
        sidebar: enSidebar(),
        footer: {
          message: 'Comprobify API Documentation',
        },
      },
    },
  },

  themeConfig: {
    nav: [
      { text: 'Inicio', link: '/' },
      { text: 'Primeros Pasos', link: '/getting-started' },
      { text: 'Endpoints', link: '/endpoints/' },
      { text: 'Referencia de errores', link: '/errors/' },
    ],

    sidebar: esSidebar(),

    socialLinks: [
      { icon: 'github', link: 'https://github.com/novaej/comprobify' },
    ],

    footer: {
      message: 'Documentación de la API de Comprobify',
    },
  },
})
