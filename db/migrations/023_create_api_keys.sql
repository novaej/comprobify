CREATE TABLE api_keys (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  issuer_id  UUID NOT NULL REFERENCES issuers(id),
  key_hash   TEXT NOT NULL UNIQUE,
  label      VARCHAR(100),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_issuer_id ON api_keys(issuer_id);
