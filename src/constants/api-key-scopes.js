const ApiKeyScopes = Object.freeze({
  DOCUMENTS_WRITE: 'documents:write',
  DOCUMENTS_READ: 'documents:read',
  ISSUERS_MANAGE: 'issuers:manage',
  ACCOUNT_MANAGE: 'account:manage',
});

const ALL_SCOPES = Object.freeze(Object.values(ApiKeyScopes));

module.exports = { ApiKeyScopes, ALL_SCOPES };
