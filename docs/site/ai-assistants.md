# Conectar un asistente de IA

Puedes conectar un asistente de IA compatible con MCP (por ejemplo Claude) a tu cuenta de Comprobify para consultar tus comprobantes y emisores conversando. El asistente actúa en tu nombre, con tu propio inicio de sesión, y **solo puede leer**: no puede crear, modificar ni anular nada.

Está disponible en **todos los planes**, incluido FREE. No necesitas una API key ni se te muestra ninguna.

## Qué puede ver el asistente

- **Tus comprobantes electrónicos**: listarlos y consultar su estado y sus datos.
- **Tus emisores**: sucursales, puntos de emisión y sus datos.

Ve lo mismo que tú ves en la aplicación web. Si tu usuario solo tiene acceso a ciertos emisores, el asistente solo ve esos.

## Cómo conectarlo

1. En tu asistente, agrega un servidor MCP (o "conector") con esta dirección:

   ```
   https://comprobify.com/mcp
   ```

2. Se abre el navegador en la aplicación web de Comprobify. Inicia sesión si aún no lo has hecho.
3. Revisa la pantalla de autorización: muestra qué aplicación pide acceso, a qué cuenta y qué podrá hacer. Pulsa **Permitir**.
4. Vuelves al asistente, ya conectado.

Solo inicias sesión en Comprobify. Tu contraseña nunca llega al asistente.

::: warning Autoriza solo lo que tú iniciaste
El nombre que aparece en la pantalla de autorización lo declara la propia aplicación y no está verificado. Continúa únicamente si acabas de iniciar la conexión desde tu asistente. Si la pantalla aparece sin que la hayas pedido, pulsa **Cancelar**.
:::

## Revocar el acceso

En la aplicación web, ve a **Configuración › Aplicaciones conectadas**. Ahí aparece cada aplicación conectada, cuándo la conectaste y cuándo se usó por última vez. Pulsa **Revocar acceso** y deja de funcionar de inmediato.

El acceso también termina solo si tu usuario se elimina de la cuenta o se desactiva, o si cambia tu rol y ya no cubre lo que habías autorizado.

## Volver a autorizar

Cada cierto tiempo Comprobify te pide confirmar de nuevo la autorización, aunque no hayas revocado nada. Es intencional: una aprobación no queda vigente para siempre.

## Si quieres construir tu propia integración

Esta conexión es para consultar tu cuenta desde un asistente. Para integrar tu propio sistema (emitir comprobantes desde tu ERP, recibir webhooks) usa la API con una API key, disponible desde el plan STARTER. Ver [Primeros Pasos](getting-started.md) y [Administrar API keys](endpoints/api-keys.md).
