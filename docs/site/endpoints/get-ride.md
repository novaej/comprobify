# Consultar RIDE (PDF)

Descarga el RIDE (Representación Impresa del Documento Electrónico) como PDF. Solo disponible para comprobantes autorizados.

```
GET /v1/documents/:accessKey/ride
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos de un comprobante `AUTHORIZED` |

### Ejemplo

```http
GET /v1/documents/1503202601179234567800110010010000000011234567810/ride
Authorization: Bearer <your-api-key>
X-Issuer-Id: 00000000-0000-0000-0000-000000000001
```

## Respuesta

**200 OK** — descarga de archivo PDF.

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="RIDE-<accessKey>.pdf"
```

El PDF se genera bajo demanda y no se almacena. Cada solicitud genera una copia nueva.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `BAD_REQUEST` | 400 | El comprobante no está en estado `AUTHORIZED` |
| `UNAUTHORIZED` | 401 | API key ausente o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
