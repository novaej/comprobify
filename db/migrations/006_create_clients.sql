CREATE TABLE clients (
  id            SERIAL PRIMARY KEY,
  issuer_id     INTEGER NOT NULL REFERENCES issuers(id),
  id_type       VARCHAR(2) NOT NULL,
  identifier    VARCHAR(20) NOT NULL,
  name          VARCHAR(300) NOT NULL,
  address       VARCHAR(300),
  email         VARCHAR(200),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issuer_id, identifier)
);
CREATE INDEX idx_clients_issuer_id ON clients(issuer_id);
CREATE INDEX idx_clients_identifier ON clients(identifier);
