CREATE TABLE IF NOT EXISTS cat_document_types (
    code        VARCHAR(2) PRIMARY KEY,
    short_name  VARCHAR(3) NOT NULL,
    description VARCHAR(100) NOT NULL
);

INSERT INTO cat_document_types (code, short_name, description) VALUES
    ('01', 'FAC', 'Factura'),
    ('03', 'LIQ', 'Liquidación de compra de bienes y prestación de servicios'),
    ('04', 'CRE', 'Nota de crédito'),
    ('05', 'DEB', 'Nota de débito'),
    ('06', 'REM', 'Guía de remisión'),
    ('07', 'RET', 'Comprobante de retención')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS cat_emission_types (
    code        VARCHAR(1) PRIMARY KEY,
    short_name  VARCHAR(3) NOT NULL,
    description VARCHAR(50) NOT NULL
);

INSERT INTO cat_emission_types (code, short_name, description) VALUES
    ('1', 'NRM', 'Emisión normal')
ON CONFLICT (code) DO NOTHING;
