CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  issuer_id     UUID NOT NULL REFERENCES issuers(id),
  main_code     VARCHAR(25) NOT NULL,
  aux_code      VARCHAR(25),
  description   VARCHAR(300) NOT NULL,
  unit_price    DECIMAL(14,6) NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issuer_id, main_code)
);
CREATE INDEX idx_products_issuer_id ON products(issuer_id);
