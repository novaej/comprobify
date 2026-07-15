# Catalogs

Reference data endpoints for SRI-defined codes. All return static lookup tables used when building invoices.

All catalog endpoints require authentication.

---

## GET /v1/catalogs/id-types

Returns buyer identification types.

```
GET /v1/catalogs/id-types
```

**Response**

```json
{
  "ok": true,
  "idTypes": [
    { "code": "04", "description": "RUC" },
    { "code": "05", "description": "Cédula" },
    { "code": "06", "description": "Pasaporte" },
    { "code": "07", "description": "Consumidor final" },
    { "code": "08", "description": "Identificación del exterior" }
  ]
}
```

---

## GET /v1/catalogs/payment-methods

Returns SRI payment method codes.

```
GET /v1/catalogs/payment-methods
```

**Response**

```json
{
  "ok": true,
  "paymentMethods": [
    { "code": "01", "description": "Sin utilización del sistema financiero" },
    { "code": "15", "description": "Compensación de deudas" },
    { "code": "16", "description": "Tarjeta de débito" },
    { "code": "17", "description": "Dinero electrónico" },
    { "code": "18", "description": "Tarjeta prepago" },
    { "code": "19", "description": "Tarjeta de crédito" },
    { "code": "20", "description": "Otros con utilización del sistema financiero" },
    { "code": "21", "description": "Endoso de títulos" }
  ]
}
```

---

## GET /v1/catalogs/term-units

Returns accepted payment term units (SRI `unidadTiempo`). Use together with `payments[].term` to express installment plans (`pagos a plazos`).

```
GET /v1/catalogs/term-units
```

**Response**

```json
{
  "ok": true,
  "termUnits": [
    { "code": "dias", "description": "Días" },
    { "code": "meses", "description": "Meses" }
  ]
}
```

---

## GET /v1/catalogs/tax-types

Returns SRI tax type codes.

```
GET /v1/catalogs/tax-types
```

**Response**

```json
{
  "ok": true,
  "taxTypes": [
    { "code": "2", "description": "IVA" },
    { "code": "3", "description": "ICE" },
    { "code": "5", "description": "IRBPNR" }
  ]
}
```

---

## GET /v1/catalogs/tax-rates

Returns tax rate codes grouped by tax type. Use `taxCode` + `rateCode` together when specifying taxes on invoice items.

```
GET /v1/catalogs/tax-rates
```

**Response**

```json
{
  "ok": true,
  "taxRates": [
    { "taxCode": "2", "rateCode": "0",    "description": "0%",              "rate": "0.00" },
    { "taxCode": "2", "rateCode": "2",    "description": "15%",             "rate": "15.00" },
    { "taxCode": "2", "rateCode": "3",    "description": "14% (histórico)", "rate": "14.00" },
    { "taxCode": "2", "rateCode": "6",    "description": "No objeto de IVA","rate": "0.00" },
    { "taxCode": "2", "rateCode": "7",    "description": "Exento de IVA",   "rate": "0.00" },
    { "taxCode": "3", "rateCode": "3051", "description": "ICE Grupo I",     "rate": "0.00" },
    { "taxCode": "5", "rateCode": "5001", "description": "IRBPNR",          "rate": "0.02" }
  ]
}
```

---

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
