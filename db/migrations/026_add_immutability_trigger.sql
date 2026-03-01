CREATE OR REPLACE FUNCTION enforce_document_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Permanently immutable columns (set on INSERT, never changed)
  IF NEW.access_key       IS DISTINCT FROM OLD.access_key       THEN
    RAISE EXCEPTION 'Column access_key is immutable';
  END IF;
  IF NEW.sequential       IS DISTINCT FROM OLD.sequential       THEN
    RAISE EXCEPTION 'Column sequential is immutable';
  END IF;
  IF NEW.issuer_id        IS DISTINCT FROM OLD.issuer_id        THEN
    RAISE EXCEPTION 'Column issuer_id is immutable';
  END IF;
  IF NEW.document_type    IS DISTINCT FROM OLD.document_type    THEN
    RAISE EXCEPTION 'Column document_type is immutable';
  END IF;
  IF NEW.issue_date       IS DISTINCT FROM OLD.issue_date       THEN
    RAISE EXCEPTION 'Column issue_date is immutable';
  END IF;
  IF NEW.branch_code      IS DISTINCT FROM OLD.branch_code      THEN
    RAISE EXCEPTION 'Column branch_code is immutable';
  END IF;
  IF NEW.issue_point_code IS DISTINCT FROM OLD.issue_point_code THEN
    RAISE EXCEPTION 'Column issue_point_code is immutable';
  END IF;

  -- Set-once columns (NULL → value is allowed; changing a set value is forbidden)
  IF OLD.authorization_xml IS NOT NULL
     AND NEW.authorization_xml IS DISTINCT FROM OLD.authorization_xml THEN
    RAISE EXCEPTION 'Column authorization_xml is set-once and cannot be changed';
  END IF;
  IF OLD.authorization_number IS NOT NULL
     AND NEW.authorization_number IS DISTINCT FROM OLD.authorization_number THEN
    RAISE EXCEPTION 'Column authorization_number is set-once and cannot be changed';
  END IF;
  IF OLD.authorization_date IS NOT NULL
     AND NEW.authorization_date IS DISTINCT FROM OLD.authorization_date THEN
    RAISE EXCEPTION 'Column authorization_date is set-once and cannot be changed';
  END IF;

  -- XML / payload columns may only change when transitioning to SIGNED (rebuild path)
  IF NEW.status != 'SIGNED' THEN
    IF NEW.unsigned_xml    IS DISTINCT FROM OLD.unsigned_xml    THEN
      RAISE EXCEPTION 'Column unsigned_xml can only be updated when transitioning to SIGNED';
    END IF;
    IF NEW.signed_xml      IS DISTINCT FROM OLD.signed_xml      THEN
      RAISE EXCEPTION 'Column signed_xml can only be updated when transitioning to SIGNED';
    END IF;
    IF NEW.request_payload IS DISTINCT FROM OLD.request_payload THEN
      RAISE EXCEPTION 'Column request_payload can only be updated when transitioning to SIGNED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_immutability
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_document_immutability();
