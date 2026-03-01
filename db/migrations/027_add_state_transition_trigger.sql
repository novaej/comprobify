CREATE OR REPLACE FUNCTION enforce_document_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- No status change — nothing to validate
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Validate the transition against the allowed graph
  IF NOT (
    (OLD.status = 'SIGNED'         AND NEW.status IN ('RECEIVED', 'RETURNED'))      OR
    (OLD.status = 'RECEIVED'       AND NEW.status IN ('AUTHORIZED', 'NOT_AUTHORIZED')) OR
    (OLD.status = 'RETURNED'       AND NEW.status = 'SIGNED')                       OR
    (OLD.status = 'NOT_AUTHORIZED' AND NEW.status = 'SIGNED')
    -- AUTHORIZED is terminal: no outgoing transitions
  ) THEN
    RAISE EXCEPTION 'Invalid document state transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_state_transition
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_document_state_transition();
