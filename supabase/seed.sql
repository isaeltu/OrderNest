insert into public.roles (id, name, description) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'Administrador'),
  ('00000000-0000-0000-0000-000000000002', 'waiter', 'Mesero'),
  ('00000000-0000-0000-0000-000000000003', 'kitchen', 'Cocina'),
  ('00000000-0000-0000-0000-000000000004', 'cashier', 'Cajero')
on conflict (name) do nothing;

insert into public.permissions (name, description) values
  ('CREATE_RESTAURANT', 'Crear restaurantes'),
  ('MANAGE_USERS', 'Gestionar usuarios'),
  ('MANAGE_ROLES', 'Gestionar roles'),
  ('MANAGE_TABLES', 'Gestionar mesas'),
  ('MANAGE_CATEGORIES', 'Gestionar categorias'),
  ('MANAGE_PRODUCTS', 'Gestionar productos'),
  ('MANAGE_COUPONS', 'Gestionar cupones'),
  ('CREATE_ORDER', 'Crear ordenes'),
  ('SEND_ORDER_TO_KITCHEN', 'Enviar ordenes a cocina'),
  ('APPLY_COUPON', 'Aplicar cupones'),
  ('PROCESS_PAYMENT', 'Procesar pagos'),
  ('VIEW_REPORTS', 'Ver reportes'),
  ('VIEW_LOGS', 'Ver logs'),
  ('CLOSE_CASH_REGISTER', 'Cerrar caja'),
  ('PRINT_INVOICE', 'Imprimir facturas'),
  ('SEND_INVOICE_EMAIL', 'Enviar facturas por correo'),
  ('MANAGE_INVENTORY', 'Gestionar inventario'),
  ('MANAGE_FINANCES', 'Gestionar gastos y nomina'),
  ('MANAGE_SETTINGS', 'Gestionar configuracion')
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name in ('CREATE_ORDER', 'SEND_ORDER_TO_KITCHEN', 'APPLY_COUPON')
where r.name = 'waiter'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name in ('VIEW_REPORTS')
where r.name = 'kitchen'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name in (
  'PROCESS_PAYMENT',
  'VIEW_REPORTS',
  'CLOSE_CASH_REGISTER',
  'PRINT_INVOICE',
  'SEND_INVOICE_EMAIL'
)
where r.name = 'cashier'
on conflict do nothing;

insert into public.restaurants (id, name, rnc, phone, email, address)
values (
  '10000000-0000-0000-0000-000000000001',
  'Restaurante Demo',
  '101-00000-1',
  '809-000-0000',
  'admin@restaurante.com',
  'Santo Domingo, Republica Dominicana'
)
on conflict (id) do nothing;

insert into public.restaurant_tables (restaurant_id, number, capacity, status)
select '10000000-0000-0000-0000-000000000001', n, case when n in (4,8,12) then 6 else 4 end, 'available'
from generate_series(1, 12) as n
on conflict (restaurant_id, number) do nothing;

insert into public.categories (id, restaurant_id, name, description, display_order)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Bebidas', 'Bebidas frias y calientes', 1),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Platos Fuertes', 'Platos principales del menu', 2),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Arroces', 'Variedad de arroces', 3),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Carnes', 'Carnes y proteinas', 4),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Postres', 'Dulces de la casa', 5)
on conflict (id) do nothing;

insert into public.products (id, restaurant_id, category_id, name, description, price, estimated_minutes)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Coca Cola', 'Refresco regular', 120, 1),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Jugo Natural', 'Jugo de naranja natural', 150, 3),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Agua', 'Botella fria', 80, 1),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Pollo a la Parrilla', 'Pechuga marinada', 450, 18),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'Carne Guisada', 'Carne suave en salsa criolla', 400, 16),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Arroz Blanco', 'Arroz del dia', 120, 8),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'Flan de Leche', 'Postre tradicional', 180, 2)
on conflict (id) do nothing;

insert into public.coupons (restaurant_id, code, name, discount_type, discount_value, start_date, end_date)
values
  ('10000000-0000-0000-0000-000000000001', 'BEBIDAS10', '10% Bebidas', 'percentage', 10, '2026-06-01', '2026-12-31'),
  ('10000000-0000-0000-0000-000000000001', 'PLATOS15', '15% Platos Fuertes', 'percentage', 15, '2026-06-01', '2026-12-31'),
  ('10000000-0000-0000-0000-000000000001', 'POLLO50', 'RD$50 Pollo Parrilla', 'fixed', 50, '2026-06-01', '2026-12-31')
on conflict (restaurant_id, code) do nothing;

insert into public.orders (id, restaurant_id, table_id, status, business_date, created_at, closed_at)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    (select id from public.restaurant_tables where restaurant_id = '10000000-0000-0000-0000-000000000001' and number = 4),
    'paid',
    '2026-06-17',
    '2026-06-17 09:40:00+00',
    '2026-06-17 10:05:00+00'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    (select id from public.restaurant_tables where restaurant_id = '10000000-0000-0000-0000-000000000001' and number = 8),
    'paid',
    '2026-06-16',
    '2026-06-16 20:55:00+00',
    '2026-06-16 21:28:00+00'
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    (select id from public.restaurant_tables where restaurant_id = '10000000-0000-0000-0000-000000000001' and number = 10),
    'paid',
    '2026-06-15',
    '2026-06-15 19:30:00+00',
    '2026-06-15 20:00:00+00'
  )
on conflict (id) do nothing;

insert into public.order_items (order_id, product_id, quantity, unit_price)
values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', 2, 400),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 2, 150),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000007', 1, 180),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 2, 450),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000006', 2, 120),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 2, 150),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005', 1, 400),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 2, 80),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000007', 2, 180)
on conflict do nothing;

insert into public.payments (order_id, payment_method, amount_paid, change_amount)
values
  ('40000000-0000-0000-0000-000000000001', 'cash', 1510.40, 0),
  ('40000000-0000-0000-0000-000000000002', 'card', 1699.20, 0),
  ('40000000-0000-0000-0000-000000000003', 'transfer', 1085.60, 0)
on conflict (order_id) do nothing;

insert into public.invoices (order_id, invoice_number)
values
  ('40000000-0000-0000-0000-000000000001', 'FAC-20260617-DEMO01'),
  ('40000000-0000-0000-0000-000000000002', 'FAC-20260616-DEMO02'),
  ('40000000-0000-0000-0000-000000000003', 'FAC-20260615-DEMO03')
on conflict (invoice_number) do nothing;

insert into public.inventory_items (restaurant_id, product_id, stock_quantity, reorder_level, unit_cost, supplier_name)
values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 180, 36, 62, 'Distribuidora Central'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 32, 20, 70, 'Frutas del Valle'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 18, 10, 210, 'Carnes Premium'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', 8, 12, 185, 'Carnes Premium')
on conflict (restaurant_id, product_id) do nothing;

insert into public.business_expenses (id, restaurant_id, expense_date, category, expense_type, description, amount, payment_method, vendor)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-06-17', 'Servicios', 'operating', 'Energia electrica', 4200, 'transfer', 'Edesur'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2026-06-16', 'Compras', 'inventory', 'Reposicion de carnes', 8500, 'cash', 'Carnes Premium'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '2026-06-15', 'Impuestos', 'tax', 'Anticipo fiscal', 2600, 'transfer', 'DGII')
on conflict (id) do nothing;

insert into public.employee_payments (id, restaurant_id, payment_date, employee_name, role_name, amount, payment_method, notes)
values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-06-17', 'Maria Perez', 'Cajera', 3200, 'bank', 'Turno semanal'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2026-06-16', 'Luis Gomez', 'Mesero', 2800, 'cash', 'Turno nocturno')
on conflict (id) do nothing;

insert into public.business_settings (restaurant_id, billing_email, invoice_sender_name)
values ('10000000-0000-0000-0000-000000000001', 'facturacion@restaurante.com', 'Restaurante Demo')
on conflict (restaurant_id) do nothing;
