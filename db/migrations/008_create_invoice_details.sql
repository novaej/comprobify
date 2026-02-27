CREATE TABLE invoice_details (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id),
  main_code     VARCHAR(25) NOT NULL,
  aux_code      VARCHAR(25),
  description   VARCHAR(300) NOT NULL,
  quantity      DECIMAL(14,6) NOT NULL,
  unit_price    DECIMAL(14,6) NOT NULL,
  discount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal      DECIMAL(14,2) NOT NULL,
  taxes         JSONB NOT NULL,
  line_total    DECIMAL(14,2) NOT NULL
);
CREATE INDEX idx_invoice_details_document_id ON invoice_details(document_id);
