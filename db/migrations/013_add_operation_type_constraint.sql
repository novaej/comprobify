ALTER TABLE sri_responses
  ADD CONSTRAINT chk_sri_responses_operation_type
  CHECK (operation_type IN ('RECEPTION', 'AUTHORIZATION'));
