# Consultar XML

Descarga el XML del comprobante.

```
GET /v1/documents/:accessKey/xml
```

- Para comprobantes `AUTHORIZED`: devuelve el XML de autorización del SRI (incluye el número de autorización y la marca de tiempo envolviendo el documento firmado).
- Para todos los demás estados: devuelve el XML firmado tal como fue enviado al SRI.

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante |

## Respuesta

**200 OK** — descarga de archivo XML.

```
Content-Type: application/xml
Content-Disposition: attachment; filename="<accessKey>.xml"
```

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | API key ausente o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
