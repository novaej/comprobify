# Catálogos

Endpoints de datos de referencia para códigos definidos por el SRI. Todos devuelven tablas de consulta estáticas usadas al construir facturas.

Todos los endpoints de catálogos requieren autenticación.

---

## GET /v1/catalogs/id-types

Devuelve los tipos de identificación del comprador.

```
GET /v1/catalogs/id-types
```

**Respuesta**

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

Devuelve los códigos de forma de pago del SRI.

```
GET /v1/catalogs/payment-methods
```

**Respuesta**

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

Devuelve las unidades de plazo de pago aceptadas (`unidadTiempo` del SRI). Úsalo junto con `payments[].term` para expresar planes de cuotas (`pagos a plazos`).

```
GET /v1/catalogs/term-units
```

**Respuesta**

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

Devuelve los códigos de tipo de impuesto del SRI.

```
GET /v1/catalogs/tax-types
```

**Respuesta**

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

Devuelve los códigos de tarifa de impuesto agrupados por tipo de impuesto. Usa `taxCode` + `rateCode` juntos al especificar impuestos en los ítems de la factura.

```
GET /v1/catalogs/tax-rates
```

**Respuesta**

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

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida |
