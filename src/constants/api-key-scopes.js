const ApiKeyScopes = Object.freeze({
  DOCUMENTS_WRITE: 'documents:write',
  DOCUMENTS_READ: 'documents:read',
  ISSUERS_READ: 'issuers:read',
  ISSUERS_WRITE: 'issuers:write',
  KEYS_MANAGE: 'keys:manage',
  BILLING_MANAGE: 'billing:manage',
  WEBHOOKS_MANAGE: 'webhooks:manage',
  TENANT_MANAGE: 'tenant:manage',
  TENANT_PROMOTE: 'tenant:promote',
});

const ALL_SCOPES = Object.freeze(Object.values(ApiKeyScopes));

module.exports = { ApiKeyScopes, ALL_SCOPES };
