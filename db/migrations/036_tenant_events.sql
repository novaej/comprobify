CREATE TABLE tenant_events (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  BIGINT NOT NULL REFERENCES tenants(id),
  event_type VARCHAR(40) NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tenant_events_event_type
    CHECK (event_type IN ('VERIFICATION_EMAIL_SENT', 'VERIFICATION_EMAIL_FAILED', 'EMAIL_VERIFIED'))
);

CREATE INDEX idx_tenant_events_tenant_id ON tenant_events(tenant_id);
