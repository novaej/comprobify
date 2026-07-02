import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Comprobify API',
  description: 'REST API for Ecuador SRI electronic invoicing',
  base: '/',
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Endpoints', link: '/endpoints/' },
      { text: 'Error Reference', link: '/errors/' },
    ],

    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Endpoints',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/endpoints/' },
          {
            text: 'Registration',
            collapsed: false,
            items: [
              { text: 'Register', link: '/endpoints/register' },
              { text: 'Verify Email', link: '/endpoints/verify-email' },
              { text: 'Resend Verification', link: '/endpoints/resend-verification' },
            ],
          },
          {
            text: 'Tiers',
            collapsed: false,
            items: [
              { text: 'Get Tiers', link: '/endpoints/get-tiers' },
            ],
          },
          {
            text: 'Payments',
            collapsed: false,
            items: [
              { text: 'Submit Payment Proof', link: '/endpoints/submit-payment-proof' },
            ],
          },
          {
            text: 'Subscriptions',
            collapsed: false,
            items: [
              { text: 'Create Subscription', link: '/endpoints/create-subscription' },
              { text: 'Get My Subscriptions', link: '/endpoints/get-my-subscriptions' },
              { text: 'Change Tier (Upgrade/Downgrade)', link: '/endpoints/change-tier' },
              { text: 'Cancel Subscription', link: '/endpoints/cancel-subscription' },
            ],
          },
          {
            text: 'Tenants',
            collapsed: false,
            items: [
              { text: 'Get Current Tenant', link: '/endpoints/tenant-me' },
              { text: 'Update Language', link: '/endpoints/tenant-language' },
              { text: 'Promote to Production', link: '/endpoints/promote-tenant' },
            ],
          },
          {
            text: 'Issuers',
            collapsed: false,
            items: [
              { text: 'List Issuers', link: '/endpoints/list-issuers' },
              { text: 'Get Issuer', link: '/endpoints/get-issuer-me' },
              { text: 'Create Branch', link: '/endpoints/create-branch' },
              { text: 'Update Issuer', link: '/endpoints/update-issuer' },
              { text: 'Remove Issuer', link: '/endpoints/remove-issuer' },
              { text: 'Activate Issuer', link: '/endpoints/activate-issuer' },
              { text: 'Upload Logo', link: '/endpoints/upload-issuer-logo' },
              { text: 'Renew Certificate', link: '/endpoints/renew-issuer-certificate' },
              { text: 'Document Types', link: '/endpoints/document-types' },
              { text: 'Sequentials', link: '/endpoints/issuer-sequentials' },
            ],
          },
          {
            text: 'API Keys',
            collapsed: false,
            items: [
              { text: 'Manage API Keys', link: '/endpoints/api-keys' },
            ],
          },
          {
            text: 'Documents',
            collapsed: false,
            items: [
              { text: 'List Documents', link: '/endpoints/list-documents' },
              { text: 'Document Stats', link: '/endpoints/document-stats' },
              { text: 'Create Invoice', link: '/endpoints/create-invoice' },
              { text: 'Create Credit Note', link: '/endpoints/create-credit-note' },
              { text: 'Get Document', link: '/endpoints/get-document' },
              { text: 'Send to SRI', link: '/endpoints/send-to-sri' },
              { text: 'Check Authorization', link: '/endpoints/check-authorization' },
              { text: 'Rebuild Invoice', link: '/endpoints/rebuild-invoice' },
              { text: 'Get RIDE (PDF)', link: '/endpoints/get-ride' },
              { text: 'Get XML', link: '/endpoints/get-xml' },
              { text: 'Get Events', link: '/endpoints/get-events' },
              { text: 'Get Credit Notes', link: '/endpoints/get-credit-notes' },
              { text: 'Retry Emails (Batch)', link: '/endpoints/retry-emails' },
              { text: 'Retry Email (Single)', link: '/endpoints/retry-single-email' },
            ],
          },
          {
            text: 'Catalogs',
            collapsed: false,
            items: [
              { text: 'Catalog Reference', link: '/endpoints/catalogs' },
            ],
          },
          {
            text: 'Notifications',
            collapsed: false,
            items: [
              { text: 'Notifications', link: '/endpoints/notifications' },
              { text: 'Webhook Endpoints', link: '/endpoints/webhooks' },
            ],
          },
          {
            text: 'Monitoring',
            collapsed: false,
            items: [
              { text: 'Health Check', link: '/endpoints/health' },
            ],
          },
        ],
      },
      {
        text: 'Error Reference',
        collapsed: false,
        items: [
          { text: 'Error Format', link: '/errors/' },
          { text: 'Validation Error', link: '/errors/validation-error' },
          { text: 'Bad Request', link: '/errors/bad-request' },
          { text: 'Unauthorized', link: '/errors/unauthorized' },
          { text: 'Forbidden', link: '/errors/forbidden' },
          { text: 'Not Found', link: '/errors/not-found' },
          { text: 'Conflict', link: '/errors/conflict' },
          { text: 'Too Many Requests', link: '/errors/too-many-requests' },
          { text: 'SRI Submission Failed', link: '/errors/sri-error' },
          { text: 'Internal Server Error', link: '/errors/internal-error' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/novaej/comprobify' },
    ],

    footer: {
      message: 'Comprobify API Documentation',
    },
  },
})
