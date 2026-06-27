# Configuracion de Supabase para OrderNest

OrderNest es un clon independiente de Restpo (mismo codigo base, mismo historial de
commits) pensado para correr contra su **propio** proyecto de Supabase y su propio
deploy en Railway, sin tocar el proyecto de produccion. Esta guia cubre un
aprovisionamiento desde cero.

## 1. Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo (recomendado:
   nombrarlo `ordernest` para no confundirlo con el proyecto de Restpo).
2. Ve a Project Settings -> Data API y copia:
   - Project URL
   - anon public key
   - service_role key (solo para scripts administrativos, nunca para el frontend)

## 2. Variables de entorno

Crea `.env` en la raiz del repo (usa `.env.example` como base):

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_PUBLIC_KEY
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
RESEND_API_KEY=
APP_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
```

`RESEND_API_KEY` nunca debe llevar el prefijo `VITE_` (no puede exponerse al
navegador). Para produccion, guardalo como secret de Supabase (paso 7), no en el
`.env` del frontend. Reinicia `npm run dev` despues de cambiar `.env`.

## 3. Crear la base de datos (todas las migraciones, en orden)

En el SQL Editor del proyecto nuevo, ejecuta cada archivo de `supabase/migrations/`
**en este orden** (son aditivas y dependen unas de otras), y al final
`supabase/seed.sql`:

```text
202606170001_restaurant_pos_schema.sql
202606180001_inventory_finance_settings.sql
202606180002_currency_tax_settings.sql
202606180003_order_numbers.sql
202606180004_restaurant_branding_onboarding.sql
202606180005_restaurant_logo_storage.sql
202606180006_order_creation_guardrails.sql
202606180007_product_image_storage.sql
202606180008_replace_open_order_items.sql
202606180009_customers.sql
202606210001_weighted_products_printing.sql
202606210002_inventory_deduction_on_payment.sql
202606210003_report_dashboard_rpc.sql
202606230001_whatsapp_bot_and_order_cancel.sql
202606230002_whatsapp_bot_customer_capture.sql
202606240001_table_floor_plan_layout.sql
202606240002_voice_order_webhook.sql
202606240003_voice_get_menu.sql
202606240004_customer_phone_address_capture.sql
202606250001_fix_kitchen_status_for_tableless_orders.sql
202606260001_voice_call_logs.sql
202606270001_platform_super_admin.sql
202606270002_reservations.sql
202606270003_staff_management.sql
supabase/seed.sql
```

Las ultimas tres (`202606270001`-`202606270003`) solo existen en OrderNest, no en
Restpo:

- `202606270001_platform_super_admin.sql`: limita "crear restaurante" a un unico
  super admin de la plataforma (ver paso 6), en vez de cualquier `admin` de cualquier
  restaurante.
- `202606270002_reservations.sql`: agrega el modulo de Reservaciones (grid + reservas).
- `202606270003_staff_management.sql`: permite que un admin cambie el rol de un
  miembro del equipo desde la app, y que cualquier usuario actualice su propio nombre
  de perfil.

Opcion CLI (alternativa a pegar cada archivo a mano):

```powershell
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

## 4. Crear buckets de Storage

Crea estos buckets (los unicos que el codigo realmente usa):

- `restaurant-logos` (publico)
- `product-images` (publico)

Las migraciones `202606180005` y `202606180007` ya incluyen el `insert into
storage.buckets` y las policies de RLS; si las corriste completas no necesitas
crearlos a mano desde el dashboard.

## 5. Activar Realtime

Las migraciones ya agregan estas tablas a la publicacion `supabase_realtime` por SQL
(no requiere pasos manuales en el dashboard): `orders`, `order_items`, `payments`,
`restaurant_tables`, `inventory_items`, `whatsapp_handoffs` y `reservations` (esta
ultima nueva en OrderNest, para que el grid de reservaciones se actualice en vivo). En
Database -> Replication puedes confirmar que las 7 estan activas.

## 6. Crear el primer usuario y el super admin de la plataforma

En Authentication -> Users:

1. Crea el usuario super admin con el correo **`isaelcapellanlite@gmail.com`**. No le
   pongas `restaurant_id` en metadata -- este usuario no pertenece a ningun
   restaurante, es quien registra restaurantes nuevos desde la pantalla
   "Restaurantes" (solo visible para este correo exacto, ver `202606270001`).
2. Crea el primer restaurante (desde la app, logueado como super admin, en
   Restaurantes -> Nuevo restaurante) o por SQL directo en `public.restaurants`.
3. Crea el primer usuario `admin` de ese restaurante con metadata:

```json
{
  "full_name": "Admin Demo",
  "role": "admin",
  "restaurant_id": "ID-DEL-RESTAURANTE"
}
```

El trigger `handle_new_user` crea el perfil automaticamente. Roles validos: `admin`,
`waiter`, `kitchen`, `cashier`.

**Importante:** ningun otro usuario, sin importar su rol, puede registrar restaurantes
nuevos -- el RPC `create_restaurant` y la policy de lectura de `restaurants` ahora
exigen `is_platform_super_admin()`, que solo es verdadero para ese correo exacto.

## 7. Secrets y deploy de las Edge Functions

```powershell
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
npx supabase secrets set RESEND_FROM_EMAIL="OrderNest <facturas@tudominio.com>"
npx supabase secrets set ALLOWED_ORIGINS="https://tu-dominio-en-railway.up.railway.app"

npx supabase functions deploy notify-new-order
npx supabase functions deploy send-invoice-email
npx supabase functions deploy voice-order-webhook --no-verify-jwt
```

- `notify-new-order` y `send-invoice-email` necesitan `RESEND_API_KEY` (obligatorio) y
  `RESEND_FROM_EMAIL` (opcional, usa `onboarding@resend.dev` si no lo pones).
- `voice-order-webhook` se autentica con la `api_key` propia del restaurante (no con
  sesion de Supabase), por eso necesita `--no-verify-jwt` al desplegar.

## 8. Bot de WhatsApp (n8n) -- si lo vas a usar en OrderNest

El workflow `n8n/whatsapp-order-bot.json` tiene la URL y la `anon key` del proyecto de
Supabase **escritas directamente en 4 nodos** (no usa variables de entorno de n8n). Si
quieres un bot de WhatsApp independiente para OrderNest:

1. Duplica el workflow en n8n (no lo compartas con el de Restpo).
2. Actualiza esos 4 nodos ("Supabase: bot_get_menu", "Supabase: bot_create_order",
   "Supabase: bot_create_handoff", "Edge Function: notify-new-order") con la URL y
   anon key del proyecto **nuevo**.
3. Sigue el resto de `n8n/README.md` (token de Meta, webhook, etc.) tal cual.

Esto es trabajo manual aparte -- no se automatiza desde este repo.

## 9. Ejecutar la app localmente

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Abre `http://127.0.0.1:5173/`.

## 10. Deploy a Railway

La app es un SPA de Vite sin servidor propio; en produccion se sirve el build estatico
con el paquete `serve` (ya en `package.json`):

1. En Railway: **New Project -> Deploy from GitHub repo** (apunta al repo de
   OrderNest, no al de Restpo).
2. Build command: `npm run build`
3. Start command: `npm run start` (corre `serve -s dist -l $PORT`; Railway define
   `$PORT` automaticamente).
4. Variables de entorno en Railway (Settings -> Variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `APP_URL` (la URL publica que Railway te asigne)
   - `ALLOWED_ORIGINS` (la misma URL, para los Edge Functions que la lean via CORS)
5. **No** pongas `SUPABASE_SERVICE_ROLE_KEY` en Railway: el frontend no la necesita y
   nunca debe viajar al navegador.
6. Despues del primer deploy, actualiza `ALLOWED_ORIGINS` en los secrets de Supabase
   (paso 7) con la URL real de Railway.

## 11. Reportes disponibles

La base crea estas funciones RPC: `report_sales_summary`, `report_sales_by_day`,
`report_top_products`, `report_profit_loss`. Filtros soportados: fecha inicial/final,
estado de orden, metodo de pago, numero de mesa, nombre de mesero. La pantalla
Reportes las usa cuando `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` existen; si no,
usa datos demo locales.

## 12. Modulos administrativos

Incluye `inventory_items` (stock/costo/proveedor/reorden), `business_expenses`,
`employee_payments`, `business_settings` (correo, remitente, moneda, locale) y
`tax_rules`. Permisos: `MANAGE_INVENTORY`, `MANAGE_FINANCES`, `MANAGE_SETTINGS`,
otorgados a `admin` en el seed.

## 13. Restaurantes, logos, ordenes, fotos y clientes

- Registro de restaurantes (solo super admin, ver paso 6), edicion de datos del
  negocio actual en Configuracion, logo/nombre del restaurante en la app, datos
  fiscales en PDF y correos.
- Bucket publico `restaurant-logos`, funcion `set_restaurant_logo`.
- `create_order_with_items`: crea la orden y sus productos en una sola operacion.
- `replace_order_items`: actualiza productos de una orden abierta antes de enviarla a
  cocina.
- Bucket publico `product-images` para fotos de producto.
- Tabla `customers` por restaurante (correo unico, tipo persona/empresa + RNC),
  funciones `upsert_customer` y `assign_order_customer`.

## 14. Enviar facturas con Resend

1. En Resend, crea una API key y verifica un dominio para enviar desde tu correo real
   (para pruebas, `onboarding@resend.dev` funciona sin dominio verificado).
2. Guarda los secrets (ver paso 7) y despliega `send-invoice-email`.
3. En la app, entra como administrador, abre Configuracion y guarda nombre remitente y
   correo administrativo.
4. Desde Caja o Historial, presiona Enviar email.

## 15. Reservaciones (nuevo en OrderNest)

La migracion `202606270002_reservations.sql` agrega:

- Columna `floor` en `restaurant_tables` (para las pestanas "1st/2nd/3rd Floor" del
  grid de reservaciones; reusa la columna `name` existente para las etiquetas de fila
  como "Bar", "A1", "A2"...).
- Tabla `reservations` con RLS por restaurante y el permiso `MANAGE_RESERVATIONS`
  (otorgado a `admin` y `waiter`).
- RPCs `create_reservation`, `update_reservation_status`, `change_reservation_table`.

No se guarda el numero de tarjeta completo, solo `card_last4` -- por seguridad (PCI),
nunca el PAN real.

## 16. Manage Access / Mi Perfil (nuevo en OrderNest)

La migracion `202606270003_staff_management.sql` agrega:

- `update_staff_role(profile_id, role)`: un admin puede cambiar el rol de un miembro
  del equipo desde Perfil -> Manage Access. Antes no existia ninguna policy de UPDATE
  para `profiles`, asi que esto tenia que hacerse a mano en el dashboard.
- `update_my_profile(full_name)`: cualquier usuario puede actualizar su propio nombre
  desde Perfil -> My Profile. El email/contrasena se actualizan via
  `supabase.auth.updateUser()` directamente (viven en `auth.users`, no en `profiles`).
