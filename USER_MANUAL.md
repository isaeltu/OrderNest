# Manual de Usuario - Restaurant POS Pro

## Inicio de sesion

1. Abre la aplicacion.
2. Ingresa correo y contrasena.
3. Usa uno de estos usuarios demo si estas probando localmente:
   - `admin@restaurante.com`
   - `mesero@restaurante.com`
   - `cocina@restaurante.com`
   - `caja@restaurante.com`
4. El sistema abre la pantalla principal segun el rol.

## Roles

- Administrador: gestiona restaurantes, usuarios, mesas, categorias, productos, cupones, reportes, configuracion y logs.
- Mesero: selecciona mesas, toma pedidos, aplica cupones permitidos y envia ordenes a cocina.
- Cocina: ve ordenes del KDS y cambia estados a en preparacion, listo o entregado.
- Cajero: cobra ordenes, imprime recibos, envia facturas y consulta ventas del turno.

## Crear restaurante

En la version conectada a Supabase, entra como administrador, abre Restaurantes y registra nombre, RNC, telefono, direccion, correo y logo. Luego abre Configuracion para editar los datos del negocio actual. Cada usuario debe quedar asociado al `restaurant_id` correcto en Supabase Auth.

El nombre y logo del restaurante se muestran en la app segun el restaurante del usuario conectado.

## Crear mesas

1. Entra como administrador.
2. Abre Mesas.
3. Presiona Nueva Mesa.
4. Indica numero, nombre opcional, capacidad y estado inicial.
5. Guarda.

## Crear categorias

1. Entra como administrador.
2. Abre Categorias.
3. Presiona Nueva Categoria.
4. Agrega nombre, descripcion, imagen, orden visual y estado.
5. Guarda.

## Crear productos

1. Entra como administrador.
2. Abre Productos.
3. Presiona Nuevo Producto.
4. Completa nombre, descripcion, categoria, precio, imagen, disponibilidad, impuesto y tiempo estimado.
5. Guarda.

## Gestionar inventario

1. Entra como administrador.
2. Abre Inventario.
3. Presiona Ajustar producto.
4. Selecciona el producto, stock actual, nivel de reorden, costo unitario y proveedor.
5. Guarda.

La pantalla muestra valor de inventario, productos configurados y productos que necesitan reposicion.

## Registrar gastos y pagos a empleados

1. Entra como administrador.
2. Abre Finanzas.
3. Usa Nuevo gasto para registrar servicios, compras, impuestos, inventario u otros gastos.
4. Usa Nuevo pago en Pagos a empleados para nomina, turnos o pagos puntuales.
5. Estos registros se usan en Reportes para calcular ganancia o perdida.

## Tomar una orden

1. Entra como mesero.
2. Abre Mesas.
3. Selecciona una mesa disponible u ocupada.
4. En POS, elige una categoria.
5. Presiona productos para agregarlos al pedido.
6. Ajusta cantidades con los controles `-` y `+`.
7. Revisa subtotal, descuento, impuestos configurados y total.

## Enviar a cocina

1. Verifica que el pedido tenga productos.
2. Presiona Enviar a cocina.
3. La mesa pasa a estado En cocina.
4. La orden aparece en Cocina como Nuevo.

## Cambiar estado en cocina

1. Entra como cocina.
2. Abre Cocina.
3. En ordenes nuevas, presiona Marcar en preparacion.
4. Cuando la orden este lista, presiona Marcar como listo.
5. Al entregar, presiona Entregado.

## Cobrar

1. Entra como cajero.
2. Abre Caja.
3. Selecciona la factura pendiente.
4. Revisa los productos y totales.
5. Elige metodo de pago.
6. Presiona Cobrar.
7. La orden queda pagada y la mesa vuelve a disponible.

## Imprimir factura

Desde Caja, selecciona la factura y presiona Imprimir. En una integracion real, puede usarse impresion del navegador, QZ Tray o un servicio local ESC/POS.

## Exportar factura a PDF

Desde Caja, selecciona la factura y presiona Exportar PDF. El sistema descarga un PDF con productos, mesa, fecha, subtotal, impuestos configurados y total.

## Enviar factura por correo

Desde Configuracion, registra el nombre remitente, el correo administrativo de facturacion, la moneda y los impuestos activos. Luego, desde Caja o Historial, selecciona la factura y presiona Enviar email. El sistema pedira el correo del cliente y enviara una plantilla HTML usando la Edge Function `send-invoice-email`.

Para que funcione en produccion, configura `RESEND_API_KEY`, `RESEND_FROM_EMAIL` y despliega la funcion de Supabase.

## Aplicar cupones

1. En POS, agrega productos al pedido.
2. Escribe el codigo del cupon.
3. Presiona Aplicar.
4. El sistema valida que el cupon este activo y aplica el descuento al total.

Cupones demo:

- `BEBIDAS10`
- `PLATOS15`
- `POLLO50`

## Vender productos por libra

1. En Productos, crea o edita el producto.
2. En Modalidad de venta selecciona Por libra y registra el precio por libra.
3. En POS, selecciona el producto y escribe el peso con precision de hasta 0.001 lb.
4. Confirma el peso. El pedido, los impuestos, la factura y los reportes calculan el importe usando `peso x precio por libra`.

Los productos por unidad continúan funcionando sin cambios. Para habilitar cantidades decimales en Supabase ejecuta `supabase/migrations/202606210001_weighted_products_printing.sql`.

Para descontar existencias automaticamente al cobrar, ejecuta también `supabase/migrations/202606210002_inventory_deduction_on_payment.sql`. Solo se descuentan productos que tengan un registro configurado en Inventario. Si no hay suficiente existencia, el cobro se detiene y muestra el producto y la cantidad faltante.

## Imprimir tickets termicos de 80 mm

En Configuracion, abre Impresora de tickets y elige uno de estos modos:

- Impresora instalada en el sistema: abre el dialogo nativo del navegador y funciona con impresoras USB o Wi-Fi reconocidas por Windows/macOS.
- Puente local ESC/POS: envia por HTTP una plantilla HTML de 80 mm al endpoint configurado. El servicio recibe `{ format, paperWidthMm, html }`.

Desde Caja puedes imprimir el ticket manualmente o activar Imprimir ticket de 80 mm al confirmar el cobro. Si el puente ESC/POS no responde o el navegador bloquea la ventana de impresion, el sistema descarga automaticamente el PDF de la factura.

Por seguridad, los navegadores no permiten detectar universalmente si una impresora fisica esta apagada ni enviar bytes ESC/POS directamente a cualquier dispositivo. Para impresion silenciosa se necesita un puente local autorizado, por ejemplo un servicio propio, QZ Tray o el agente del fabricante.

## Ver historial

Abre Historial para ver las ultimas ordenes. Puedes buscar por numero de orden, mesa o mesero, filtrar por estado, exportar PDF y enviar la factura por correo.

Con Supabase conectado, el historial queda guardado en `orders`, `order_items`, `payments` e `invoices`. En modo demo local, el historial vive solo en memoria mientras la app esta abierta.

Las ordenes se muestran con un numero legible por restaurante, por ejemplo `ORD-20260618-0001`. El UUID interno queda solo para relaciones tecnicas de la base de datos.

## Ver reportes por fecha y filtros

1. Entra como administrador o cajero.
2. Abre Reportes.
3. Filtra por fecha inicial y fecha final.
4. Opcionalmente filtra por estado, metodo de pago, mesa o mesero.
5. Revisa total vendido, gastos, nomina, ganancia o perdida neta, ventas por metodo, ventas por fecha y productos mas vendidos.
6. Presiona Exportar PDF para descargar el resumen del periodo.

Si Supabase esta configurado, la pantalla usa las funciones RPC de la base de datos, incluyendo `report_profit_loss`. Si no esta configurado, usa datos demo locales.

## Configurar moneda e impuestos

1. Entra como administrador.
2. Abre Configuracion.
3. En Facturacion, selecciona la moneda del restaurante.
4. Ajusta el locale si necesitas otro formato regional, por ejemplo `es-DO`, `en-US` o `es-ES`.
5. En Impuestos, agrega uno o varios impuestos con nombre, porcentaje y estado activo.
6. Guarda.

Los impuestos activos se suman en POS, Caja, facturas PDF y reportes.

## Configurar datos del negocio en facturas

1. Entra como administrador.
2. Abre Configuracion.
3. En Datos del negocio completa nombre, RNC, telefono, correo, direccion y logo.
4. Guarda.

Estos datos aparecen en facturas PDF, correos y encabezado de la aplicacion.

## Hacer cuadre de caja

1. Entra como cajero o administrador.
2. Abre Reportes.
3. Revisa efectivo, tarjeta, transferencia, total vendido, descuentos, facturas y diferencia.
4. Presiona Cerrar caja.
5. Imprime o exporta el cuadre.

## Revisar logs

1. Entra como administrador.
2. Abre Logs.
3. Revisa usuario, accion, entidad, fecha y descripcion.
4. Filtra por usuario o fecha cuando la base de datos este conectada.

## Errores comunes

- No puedo enviar a cocina: verifica que la orden tenga productos.
- No puedo cobrar: verifica que exista una factura u orden pendiente.
- El cupon no aplica: confirma codigo, vigencia, estado activo y alcance por producto o categoria.
- La mesa no se libera: revisa que la orden haya sido cobrada.
- No aparecen imagenes: confirma conexion a internet o usa imagenes locales en Supabase Storage.
- Supabase no conecta: revisa `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, RLS y CORS.
- Realtime no actualiza: confirma que Realtime este activo para `orders`, `order_items`, `payments` y `restaurant_tables`.

## Configurar Supabase y base de datos

Consulta la guia completa en `docs/SUPABASE_SETUP.md`.

Resumen:

1. Crea un proyecto en Supabase.
2. Copia Project URL y anon public key.
3. Crea `.env` usando `.env.example`.
4. Ejecuta `supabase/migrations/202606170001_restaurant_pos_schema.sql` en SQL Editor.
5. Ejecuta `supabase/seed.sql`.
6. Ejecuta las migraciones incrementales en orden, incluida `202606210001_weighted_products_printing.sql`.
7. Crea usuarios en Authentication con metadata `role` y `restaurant_id`.
8. Reinicia la app con `npm run dev -- --host 127.0.0.1 --port 5173`.
