ALTER TABLE tenants
  ADD COLUMN verification_redirect_url  VARCHAR(2048),
  ADD COLUMN verification_email_sent_at TIMESTAMPTZ;
