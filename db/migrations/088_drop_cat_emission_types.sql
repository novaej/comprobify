-- cat_emission_types (migration 005) is unused: never read by any model/service, and its
-- seed was already incomplete (only code '1' was ever inserted, never '2'). SRI's XSD closes
-- tipoEmision's domain to exactly {1, 2} (factura_V2.1.0.xsd: <xsd:pattern value="[12]{1}"/>),
-- and both values are already handled directly in helpers/ride-builder.js's emissionLabel() —
-- the same hardcode-a-tiny-fixed-enum pattern already used there for document type header
-- labels ('01'/'04'), so nothing is lost by dropping this table.

BEGIN;

DROP TABLE cat_emission_types;

COMMIT;
