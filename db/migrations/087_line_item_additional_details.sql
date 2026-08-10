-- Per-item "Detalle Adicional" support (SRI factura_V2.1.0.xsd detalle/detallesAdicionales,
-- up to 3 detAdicional entries per item, nombre/valor attributes). Stored as a JSONB array
-- of {name, value} objects, mirroring the shape already used for document-level
-- additionalInfo. This column is an audit/query record only — it is never read back to
-- build the RIDE, which sources per-item additional details from the authorized XML
-- itself (see src/services/ride.service.js). Applied to both public and sandbox schemas
-- per CLAUDE.md Common Mistake #14.

BEGIN;

ALTER TABLE document_line_items
  ADD COLUMN additional_details JSONB NOT NULL DEFAULT '[]';

ALTER TABLE sandbox.document_line_items
  ADD COLUMN additional_details JSONB NOT NULL DEFAULT '[]';

COMMIT;
