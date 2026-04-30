import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Comprobify API',
  description: 'REST API for Ecuador SRI electronic invoicing',
  base: '/comprobify/',
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
          { text: 'Register', link: '/endpoints/register' },
          { text: 'Resend Verification', link: '/endpoints/resend-verification' },
          { text: 'Document Types', link: '/endpoints/document-types' },
          { text: 'List Documents', link: '/endpoints/list-documents' },
          { text: 'Create Invoice', link: '/endpoints/create-invoice' },
          { text: 'Get Document', link: '/endpoints/get-document' },
          { text: 'Send to SRI', link: '/endpoints/send-to-sri' },
          { text: 'Check Authorization', link: '/endpoints/check-authorization' },
          { text: 'Rebuild Invoice', link: '/endpoints/rebuild-invoice' },
          { text: 'Get RIDE (PDF)', link: '/endpoints/get-ride' },
          { text: 'Get XML', link: '/endpoints/get-xml' },
          { text: 'Get Events', link: '/endpoints/get-events' },
          { text: 'Retry Emails (Batch)', link: '/endpoints/retry-emails' },
          { text: 'Retry Email (Single)', link: '/endpoints/retry-single-email' },
          { text: 'Mailgun Webhook', link: '/endpoints/webhooks' },
          { text: 'Health Check', link: '/endpoints/health' },
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
