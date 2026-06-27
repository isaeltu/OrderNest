# Bot de pedidos por WhatsApp (n8n + Meta Cloud API + Supabase)

Este flujo (`whatsapp-order-bot.json`) recibe mensajes de WhatsApp de un cliente,
resuelve el restaurante por `phone_number_id`, usa un LLM (Anthropic Claude) para
interpretar el pedido contra el catalogo real (Supabase) y responde por WhatsApp.
Tambien crea "handoffs" cuando no entiende algo o el cliente pide hablar con una persona.

## 1. Base de datos (Supabase)

1. Aplicar la migracion `supabase/migrations/202606230001_whatsapp_bot_and_order_cancel.sql`
   (crea `restaurant_bot_settings`, `whatsapp_handoffs`, columnas `channel`/`customer_phone`/
   `customer_display_name` en `orders`, y las funciones `bot_get_menu`, `bot_create_order`,
   `bot_create_handoff`):
   ```
   supabase db push
   ```
2. Estas 3 funciones (`bot_get_menu`, `bot_create_order`, `bot_create_handoff`) estan
   `grant`-eadas a `anon` a proposito: son las unicas que n8n puede llamar sin sesion de
   usuario, y resuelven el restaurante por `whatsapp_phone_number_id`, nunca por `auth.uid()`.

## 2. Edge Function `notify-new-order`

Envia el correo de "nuevo pedido" usando Resend. Hay que desplegarla y configurarle secretos
propios (los del `.env` local NO llegan a Supabase Functions automaticamente):

```
supabase functions deploy notify-new-order
supabase secrets set RESEND_API_KEY=<tu_resend_api_key>
supabase secrets set RESEND_FROM_EMAIL="RestoPOS <pedidos@tu-dominio.com>"   # opcional, si no se pone usa onboarding@resend.dev
supabase secrets set ALLOWED_ORIGINS=http://localhost:5173                   # o tu dominio en produccion
```

Si no configuras `RESEND_API_KEY`, la funcion responde 500 pero el pedido ya quedo
registrado igual (el nodo de n8n que la llama tiene `continueOnFail`).

## 3. Credenciales en n8n (sin usar "Variables", que es de pago en n8n Cloud)

El workflow ya NO usa `$vars` (la feature de Variables esta restringida en el plan gratis
de n8n Cloud). En su lugar:

- `SUPABASE_URL` y `SUPABASE_ANON_KEY` quedaron escritos directo en los nodos (URL y
  headers `apikey`/`Authorization` de las llamadas a Supabase). No son secretos sensibles:
  la anon key es la "publishable key" que ya viaja en el bundle del navegador. Si alguna
  vez cambias de proyecto de Supabase, hay que actualizar estos 4 nodos: "Supabase:
  bot_get_menu", "Supabase: bot_create_order", "Supabase: bot_create_handoff" y "Edge
  Function: notify-new-order".
- `META_VERIFY_TOKEN` tambien quedo fijo en el nodo IF **"Token valido?"** (campo
  `rightValue` de la segunda condicion): `f76036e2d6c4fcc35375d7f9745fed96`. Este es el
  valor exacto que debes pegar como "Verify token" al configurar el webhook en Meta
  (paso 5) -- no es necesario que sea secreto, solo que coincida en los dos lados.
- `META_WHATSAPP_ACCESS_TOKEN` (este si es sensible de verdad) se pega directo como
  header manual en cada uno de los 4 nodos que llaman a la API de Meta -- "WhatsApp:
  enviar confirmacion de pedido", "enviar aclaracion de error", "enviar aviso de
  handoff" y "responder chat directo". En cada uno, **Authentication = None**, y en
  **Headers** agregar (junto al `Content-Type` que ya viene):
  - Name: `Authorization`
  - Value: `Bearer <tu_access_token_de_meta>` (con el texto "Bearer " y un espacio
    antes del token, todo en el mismo campo).

  El JSON trae un placeholder (`Bearer PEGA_AQUI_TU_TOKEN_DE_META`) en esos 4 nodos;
  hay que reemplazarlo por el token real despues de importar. El token que da Meta en
  "API Setup" es temporal (24h) -- para produccion hay que generar uno permanente
  via System User (Meta Business Settings) y volver a pegarlo aqui cuando expire.

Credencial del LLM: en el nodo **"Anthropic Chat Model"**, crear/asignar una credencial
`Anthropic account` con tu API key de Anthropic (console.anthropic.com). El nodo viene con
un id de credencial placeholder (`anthropic-credential-placeholder`) que hay que reemplazar
al importar el workflow. Si prefieres OpenAI en vez de Claude, se puede sustituir ese nodo
por "OpenAI Chat Model" (mismo conector `ai_languageModel` hacia el AI Agent).

## 4. Importar y activar el workflow

1. En n8n: **Import from File** -> `n8n/whatsapp-order-bot.json`.
2. Asignar la credencial de Anthropic en el nodo "Anthropic Chat Model" (ver arriba).
3. Activar el workflow (toggle "Active").
4. Copiar la URL de produccion del nodo **"Webhook Meta (mensajes POST)"** (la misma ruta
   `/whatsapp-bot` sirve tanto para el GET de verificacion como el POST de mensajes).

## 5. Configuracion en Meta (WhatsApp Cloud API)

1. Crear/usar una app de tipo "Business" en developers.facebook.com con el producto
   **WhatsApp** agregado.
2. Anotar el **Phone number ID** del numero de WhatsApp del negocio (Meta lo muestra en
   "API Setup" / "Configuracion de la API"). Este es el mismo valor que va en
   `whatsapp_phone_number_id` (paso 6) y en `phoneNumberId` dentro del flujo.
3. Generar el **Access Token**: para pruebas, el temporal de 24h sirve; para produccion,
   generar un token permanente (System User + token sin expiracion) y ponerlo en la
   variable `META_WHATSAPP_ACCESS_TOKEN` de n8n.
4. En **Webhooks**, configurar:
   - Callback URL: la URL de produccion del paso 4.4.
   - Verify token: `f76036e2d6c4fcc35375d7f9745fed96` (el valor fijo en el nodo "Token valido?", ver paso 3).
5. Suscribirse al campo **`messages`** del webhook para ese numero/WABA.

## 6. Configuracion en el panel admin de RestoPOS

En la app: **Configuracion -> seccion "Bot de WhatsApp"** (ya existe en `App.tsx`):

1. Activar el checkbox "Activar bot de WhatsApp para este restaurante".
2. **Phone Number ID**: pegar el mismo Phone Number ID del paso 5.2 (Meta). Es `unique`
   en la base de datos -- un numero solo puede estar asignado a un restaurante.
3. **Correo de notificacion de pedidos**: a donde llega el aviso de cada pedido nuevo.
4. **Instrucciones adicionales para el bot**: horarios, promociones, tono de respuesta.
   El catalogo (productos/precios/categorias) se lee siempre en vivo desde la base de
   datos, no hace falta repetirlo aqui.
5. Guardar. Esto escribe en `restaurant_bot_settings` (via `saveBotSettings` en
   `src/services/adminRepository.ts`), que es la tabla que usan `bot_get_menu` /
   `bot_create_order` / `bot_create_handoff` para resolver el restaurante.

## 7. Probar end-to-end

1. Enviar un mensaje de WhatsApp al numero de negocio desde un telefono de prueba
   registrado en Meta (mientras la app esta en modo desarrollo, solo numeros agregados
   como "testers" pueden escribir).
2. Verificar en n8n (pestaña "Executions") que la ejecucion llego hasta el final.
3. Verificar que se creo la orden en el POS (con `channel = 'whatsapp'`) o, si el LLM no
   entendio, que aparecio un registro en `whatsapp_handoffs`.
4. Confirmar que llego el correo de notificacion (si configuraste Resend).

## Identificacion de cliente y horario de atencion (v1.1)

El bot ahora exige nombre + correo del cliente antes de crear una orden, y respeta el
horario de atencion que describas en texto libre en "Instrucciones adicionales para el
bot" (panel admin). Esto se logro con:

- `supabase/migrations/202606230002_whatsapp_bot_customer_capture.sql`: nueva funcion
  `bot_upsert_customer(phone_number_id, full_name, email)` (busca o crea el cliente en
  `public.customers`, la misma tabla que usa el POS para facturas) y `bot_create_order`
  ahora acepta `p_customer_id` para enlazar la orden a ese cliente.
- El nodo "Construir system prompt" ahora le pasa al LLM la fecha/hora actual (zona
  Republica Dominicana) y los datos de cliente ya conocidos en la conversacion, y las
  reglas exigen tener nombre + correo + horario válido antes de usar intent "order".
- Nuevos nodos en el workflow: "Supabase: bot_upsert_customer" -> "Cliente
  identificado?" -> (si OK) "Supabase: bot_create_order" / (si falla, ej. correo
  invalido) -> "Armar mensaje de error en cliente".

**Importante**: hay que aplicar la migracion `202606230002` (`supabase db push`) y
volver a importar/actualizar el workflow en n8n para que tome estos nodos nuevos.

Para que la validacion de horario funcione, el texto en "Instrucciones adicionales
para el bot" debe describir el horario en lenguaje natural (ej. "Solo aceptamos
pedidos de 8:00 AM a 10:00 PM, hora de Republica Dominicana") -- el LLM compara eso
contra la fecha/hora real que le pasa el workflow. No es una validacion exacta de
codigo, es el LLM razonando con la hora real + tu texto; para una validacion 100%
exacta habria que agregar un campo estructurado de horario y un IF en el workflow.

## Limitaciones conocidas (v1)

- La memoria de conversacion por telefono (`workflowStaticData`) vive solo en RAM del
  proceso de n8n: se pierde si n8n se reinicia o si corre en mas de una instancia/worker.
  Para produccion seria mejor moverla a una tabla de Supabase o a Redis.
- Solo se procesan mensajes de texto. Audio, imagenes, stickers, etc. se ignoran (no
  rompen el flujo, pero tampoco generan respuesta).
- El AI Agent puede fallar el parseo de JSON; tras 3 intentos fallidos consecutivos por el
  mismo numero, el flujo fuerza un handoff en vez de seguir insistiendo.
