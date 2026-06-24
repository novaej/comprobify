-- Generic updated_at maintenance trigger.
--
-- This project uses raw parameterised SQL (no ORM), so nothing previously
-- guaranteed updated_at was bumped on every UPDATE — it depended on each
-- hand-written query remembering to include "updated_at = NOW()". That drifted
-- silently: issuers.updated_at was never set by updateLogo/updateCertificate.
--
-- A BEFORE UPDATE trigger removes the dependency on application code entirely:
-- it forces NEW.updated_at = NOW() on every row update, for every table that
-- has the column, regardless of what (if anything) the UPDATE statement set.

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issuers_updated_at
  BEFORE UPDATE ON issuers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sequential_numbers_updated_at
  BEFORE UPDATE ON public.sequential_numbers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_webhook_endpoints_updated_at
  BEFORE UPDATE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_webhook_deliveries_updated_at
  BEFORE UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sandbox schema mirrors public for tenant-scoped tables (see migration 033).
CREATE TRIGGER trg_sandbox_documents_updated_at
  BEFORE UPDATE ON sandbox.documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sandbox_sequential_numbers_updated_at
  BEFORE UPDATE ON sandbox.sequential_numbers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
