CREATE TABLE IF NOT EXISTS issuers (
    id              SERIAL PRIMARY KEY,
    ruc             VARCHAR(13) UNIQUE NOT NULL,
    business_name   VARCHAR(300) NOT NULL,
    trade_name      VARCHAR(300),
    main_address    VARCHAR(300) NOT NULL,
    branch_code     VARCHAR(3) NOT NULL,
    issue_point_code VARCHAR(3) NOT NULL,
    environment     VARCHAR(1) NOT NULL DEFAULT '1',
    emission_type   VARCHAR(1) NOT NULL DEFAULT '1',
    required_accounting VARCHAR(2),
    special_taxpayer VARCHAR(13),
    branch_address  VARCHAR(300),
    cert_path       VARCHAR(500),
    cert_password_enc TEXT,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
