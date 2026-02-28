-- cat_id_types — SRI buyer identification types
CREATE TABLE IF NOT EXISTS cat_id_types (
    code        VARCHAR(2) PRIMARY KEY,
    description VARCHAR(100) NOT NULL
);

INSERT INTO cat_id_types (code, description) VALUES
    ('04', 'RUC'),
    ('05', 'Cédula'),
    ('06', 'Pasaporte'),
    ('07', 'Consumidor final'),
    ('08', 'Identificación del exterior')
ON CONFLICT (code) DO NOTHING;

-- cat_tax_types — SRI tax types
CREATE TABLE IF NOT EXISTS cat_tax_types (
    code        VARCHAR(1) PRIMARY KEY,
    description VARCHAR(50) NOT NULL
);

INSERT INTO cat_tax_types (code, description) VALUES
    ('2', 'IVA'),
    ('3', 'ICE'),
    ('5', 'IRBPNR')
ON CONFLICT (code) DO NOTHING;

-- cat_tax_rates — rate codes per tax type
CREATE TABLE IF NOT EXISTS cat_tax_rates (
    id          SERIAL PRIMARY KEY,
    tax_code    VARCHAR(1) NOT NULL REFERENCES cat_tax_types(code),
    rate_code   VARCHAR(4) NOT NULL,
    description VARCHAR(100) NOT NULL,
    rate        DECIMAL(6,2) NOT NULL,
    UNIQUE(tax_code, rate_code)
);

INSERT INTO cat_tax_rates (tax_code, rate_code, description, rate) VALUES
    ('2', '0',    '0%',                   0.00),
    ('2', '2',    '15%',                  15.00),
    ('2', '3',    '14% (histórico)',       14.00),
    ('2', '6',    'No objeto de IVA',      0.00),
    ('2', '7',    'Exento de IVA',         0.00),
    ('3', '3051', 'ICE Grupo I',           0.00),
    ('5', '5001', 'IRBPNR',               0.02)
ON CONFLICT (tax_code, rate_code) DO NOTHING;

-- cat_payment_methods — SRI payment method codes
CREATE TABLE IF NOT EXISTS cat_payment_methods (
    code        VARCHAR(2) PRIMARY KEY,
    description VARCHAR(100) NOT NULL
);

INSERT INTO cat_payment_methods (code, description) VALUES
    ('01', 'Sin utilización del sistema financiero'),
    ('15', 'Compensación de deudas'),
    ('16', 'Tarjeta de débito'),
    ('17', 'Dinero electrónico'),
    ('18', 'Tarjeta prepago'),
    ('19', 'Tarjeta de crédito'),
    ('20', 'Otros con utilización del sistema financiero'),
    ('21', 'Endoso de títulos')
ON CONFLICT (code) DO NOTHING;
