# Acuerdos

Devuelve los acuerdos actualmente publicados (Términos de Servicio, Política de Privacidad, DPA). Estos son los documentos que un tenant acepta al registrarse. Usa estos endpoints para mostrar los documentos en tu flujo de registro.

## Listar documentos vigentes

```
GET /v1/agreements
```

**Autenticación:** Ninguna — endpoint público, sin límite de tasa.

### Respuesta

```json
{
  "ok": true,
  "documents": [
    { "documentType": "TERMS", "version": "2026-06-28", "url": "/v1/agreements/TERMS" },
    { "documentType": "PRIVACY", "version": "2026-06-28", "url": "/v1/agreements/PRIVACY" },
    { "documentType": "DPA", "version": "2026-06-28", "url": "/v1/agreements/DPA" }
  ]
}
```

El string `version` es lo que se pasa como `termsVersion` en `POST /v1/register` (o `POST /v1/tenants/agreements`). Léelo siempre desde esta respuesta en lugar de codificarlo de forma fija — el servidor valida contra lo que esté actualmente publicado.

## Obtener un documento

```
GET /v1/agreements/:type
```

**Autenticación:** Ninguna — endpoint público, sin límite de tasa.

**Parámetro de URL:** `:type` debe ser uno de `TERMS`, `PRIVACY`, o `DPA`.

Devuelve una página `text/html` completa y autocontenida — `<!DOCTYPE html>` con su propio `<head>`/`<style>` (tipografía serif, texto justificado, una jerarquía de encabezados titulada/con bordes) — formateada para verse como un documento legal formal por sí sola. Se recomienda incrustarla mediante `<iframe>` o abrirla como página completa; no está pensada para inyectarse en el DOM de una página existente (por ejemplo mediante `innerHTML`), ya que los navegadores eliminan el contenedor `<html>`/`<head>`/`<style>` en ese caso y se perdería el estilo.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `:type` no es un tipo de documento válido |
| `404` | `AGREEMENT_NOT_FOUND` | Aún no se ha publicado ningún documento de ese tipo |

## Notas

- Los documentos TERMS y PRIVACY juntos conforman el paquete de aceptación. El DPA se incorpora por referencia dentro de los Términos de Servicio — solo hay un checkbox en la interfaz, no tres.
- El valor `version` de `GET /v1/agreements` es un token de string opaco. El servidor no interpreta su formato — solo verifica que la versión presentada al momento de la aceptación coincida con la que estaba vigente cuando el usuario hizo clic en aceptar.
- Si aún no se ha publicado nada, `GET /v1/agreements` devuelve un arreglo vacío y el registro no exige una coincidencia de `termsVersion` (comportamiento de respaldo previo al lanzamiento).
