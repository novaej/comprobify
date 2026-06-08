-- cat_term_units — accepted SRI values for the unidadTiempo XML element
-- (payments[].termUnit in the API, used alongside payments[].term / SRI plazo).

BEGIN;

CREATE TABLE IF NOT EXISTS cat_term_units (
    code        VARCHAR(10) PRIMARY KEY,
    description VARCHAR(50) NOT NULL
);

INSERT INTO cat_term_units (code, description) VALUES
    ('dias', 'Días'),
    ('meses', 'Meses')
ON CONFLICT (code) DO NOTHING;

COMMIT;
