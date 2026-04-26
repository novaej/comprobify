-- Tenants are the top-level billing entity. One tenant owns one or more issuers.
-- Subscription tier controls invoice quota, issuer limits, and rate limits.
-- Tenants created via self-service start as PENDING_VERIFICATION until email is confirmed.
-- Tenants created by admin start as ACTIVE.

CREATE TABLE tenants (
  id                            BIGSERIAL PRIMARY KEY,
  email                         VARCHAR(255) NOT NULL UNIQUE,
  subscription_tier             VARCHAR(20)  NOT NULL DEFAULT 'FREE'
    CHECK (subscription_tier IN ('FREE', 'STARTER', 'GROWTH', 'BUSINESS')),
  status                        VARCHAR(30)  NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED')),
  invoice_count                 BIGINT       NOT NULL DEFAULT 0,
  invoice_quota                 INT          NOT NULL DEFAULT 100,
  verification_token            VARCHAR(64),
  verification_token_expires_at TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE issuers ADD COLUMN tenant_id BIGINT NOT NULL REFERENCES tenants(id);
