-- Every issuer must carry a branch address, same as main_address already requires.
-- SRI's printed RIDE and the signed XML both have a "Dirección Sucursal" field
-- alongside "Dirección Matriz" - leaving it NULL meant it silently printed blank
-- on the RIDE and was omitted from the XML's <dirEstablecimiento> element
-- entirely (invoice.builder.js/credit-note.builder.js only include it when
-- truthy). Application code (registration.service.js's register(),
-- issuer.service.js's createBranch()) now always supplies one, defaulting to
-- the issuer's own main_address when the caller doesn't name a distinct
-- branch address. Backfill existing rows the same way before adding the
-- constraint, so no pre-existing issuer violates it.
UPDATE issuers SET branch_address = main_address WHERE branch_address IS NULL;

ALTER TABLE issuers ALTER COLUMN branch_address SET NOT NULL;
