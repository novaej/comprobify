# Recuperar cuenta

Recupera el acceso a una cuenta existente cuando se perdió la llave API. Requiere el mismo certificado P12 usado al registrarse — la llave API se revoca y se reemplaza únicamente cuando el certificado coincide con el que está en archivo para esa cuenta.

```
POST /v1/recover
```

## Autenticación

Ninguna — endpoint público.

## Límite de tasa

Compartido con `POST /v1/register` y `POST /v1/resend-verification` — 5 solicitudes por hora por IP.

## Cuerpo de la solicitud

`multipart/form-data` (requerido — debe incluirse un archivo de certificado P12).

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `cert` | file | Sí | Archivo de certificado P12 del SRI — debe coincidir con el certificado en archivo para la cuenta |
| `certPassword` | string | No | Contraseña del P12 (omitir si no tiene) |
| `email` | string | Sí | Correo de la cuenta a recuperar |

## Respuesta

Este endpoint devuelve **siempre la misma forma de respuesta genérica** salvo que el certificado coincida realmente con una cuenta existente — ver la sección "Comportamiento contra enumeración" abajo.

### 200 OK — certificado coincide con una cuenta existente

La llave API actual para el entorno vigente de la cuenta (sandbox o producción) se revoca y se emite una nueva de inmediato.

```json
{
  "ok": true,
  "tenant": {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "you@company.com",
    "subscriptionTier": "FREE",
    "status": "ACTIVE",
    "documentQuota": 100,
    "documentCount": 12
  },
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000001",
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": null,
    "branchCode": "001",
    "issuePointCode": "001",
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  },
  "apiKey": "abc123...",
  "environment": "sandbox"
}
```

`environment` refleja el entorno **real y actual** de la cuenta (`"sandbox"` o `"production"`) — un tenant ya promovido a producción recupera su llave de producción, no una de sandbox.

Adicionalmente, se envía en segundo plano un correo de verificación como aviso — no bloquea esta respuesta y no afecta la llave ya emitida.

### 200 OK — cualquier otro caso

```json
{
  "ok": true,
  "message": "If this email and certificate match an existing account, a new key has been issued."
}
```

Esta misma respuesta genérica se devuelve cuando el correo no está registrado, cuando la cuenta no tiene emisor (estado inconsistente), o cuando el certificado no coincide con el archivado — deliberadamente, para no revelar cuál de esos casos ocurrió (ver abajo).

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Falta el correo, el archivo P12, o tienen formato inválido |
| `400` | `CERTIFICATE_INVALID` / `CERTIFICATE_PASSWORD_INVALID` / `CERTIFICATE_KEY_NOT_FOUND` / `CERTIFICATE_EXPIRED` | El archivo P12 está corrupto, la contraseña es incorrecta, o el certificado expiró — estos errores ocurren **antes** de buscar la cuenta, por lo que nunca revelan si el correo existe |
| `403` | `ACCOUNT_SUSPENDED` | La cuenta está suspendida — solo se revela cuando el certificado enviado sí coincide con el archivado (ver abajo) |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

## Comportamiento contra enumeración

Este endpoint está diseñado deliberadamente para que un llamador **sin el certificado correcto** no pueda distinguir entre:

- el correo no está registrado
- el correo está registrado pero la cuenta no tiene emisor (estado inconsistente)
- el correo está registrado pero el certificado enviado no coincide

Los tres casos devuelven exactamente la misma respuesta `200` genérica, sin llave, sin revocar ni emitir nada. Un certificado que coincide es la misma prueba de propiedad que acepta el registro nuevo — solo en ese caso se emite la llave, y solo en ese caso se revela si la cuenta está suspendida.

Los errores de certificado (archivo corrupto, contraseña incorrecta, certificado expirado) se validan **antes** de buscar la cuenta por correo, así que tampoco correlacionan con la existencia de la cuenta.

## Notas

- No confundir con `POST /v1/register` — ese endpoint es solo para cuentas nuevas; si el correo ya existe, rechaza con `409 CONFLICT` y no revoca ni emite ninguna llave.
- El correo de aviso reutiliza el mismo mecanismo de `POST /v1/resend-verification` (mismo token, misma plantilla) — para una cuenta ya `ACTIVE`, hacer clic en el enlace simplemente reconfirma el estado sin efecto adicional.
