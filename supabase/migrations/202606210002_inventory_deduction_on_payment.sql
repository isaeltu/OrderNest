-- Deduct tracked inventory atomically when an order is paid.
-- Run after 202606210001_weighted_products_printing.sql and 202606180009_customers.sql.

alter table public.inventory_items
  alter column stock_quantity type numeric(12,3) using stock_quantity::numeric,
  alter column reorder_level type numeric(12,3) using reorder_level::numeric;

create or replace function public.process_payment(
  p_order_id uuid,
  p_payment_method text,
  p_amount_paid numeric,
  p_customer_email text default null,
  p_customer_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_invoice_id uuid;
  order_total numeric(10,2);
  target_customer_id uuid;
  target_customer_email text;
  target_customer_name text;
  target_customer_rnc text;
  target_restaurant_id uuid;
  stock_line record;
  current_stock numeric(12,3);
begin
  if not public.has_permission('PROCESS_PAYMENT') then
    raise exception 'No tienes permiso para procesar pagos.';
  end if;

  target_restaurant_id := public.current_restaurant_id();

  select o.total, o.customer_id
  into order_total, target_customer_id
  from public.orders o
  where o.id = p_order_id
    and o.restaurant_id = target_restaurant_id
    and o.status <> 'paid'
  for update;

  if order_total is null then
    raise exception 'La orden no existe o ya fue pagada.';
  end if;

  -- Lock and validate every inventory row before changing financial state.
  -- Products without an inventory row are intentionally not tracked.
  for stock_line in
    select oi.product_id, p.name as product_name, sum(oi.quantity)::numeric(12,3) as sold_quantity
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
    group by oi.product_id, p.name
  loop
    select ii.stock_quantity
    into current_stock
    from public.inventory_items ii
    where ii.restaurant_id = target_restaurant_id
      and ii.product_id = stock_line.product_id
    for update;

    if found then
      if current_stock < stock_line.sold_quantity then
        raise exception 'Stock insuficiente para %. Disponible: %, solicitado: %.',
          stock_line.product_name,
          current_stock,
          stock_line.sold_quantity;
      end if;

      update public.inventory_items
      set stock_quantity = stock_quantity - stock_line.sold_quantity
      where restaurant_id = target_restaurant_id
        and product_id = stock_line.product_id;
    end if;
  end loop;

  if target_customer_id is null and nullif(trim(coalesce(p_customer_email, '')), '') is not null then
    target_customer_id := public.upsert_customer(
      p_customer_type := 'person',
      p_full_name := coalesce(p_customer_name, p_customer_email),
      p_email := p_customer_email,
      p_rnc := null
    );
  end if;

  select c.email, c.full_name, c.rnc
  into target_customer_email, target_customer_name, target_customer_rnc
  from public.customers c
  where c.id = target_customer_id
    and c.restaurant_id = target_restaurant_id;

  insert into public.payments (order_id, cashier_id, payment_method, amount_paid, change_amount)
  values (p_order_id, auth.uid(), p_payment_method, p_amount_paid, greatest(p_amount_paid - order_total, 0));

  update public.orders
  set status = 'paid', closed_at = now(), customer_id = target_customer_id
  where id = p_order_id;

  update public.restaurant_tables t
  set status = 'available'
  from public.orders o
  where o.id = p_order_id and t.id = o.table_id;

  insert into public.invoices (order_id, invoice_number, customer_id, customer_email, customer_name, customer_rnc)
  values (
    p_order_id,
    'FAC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    target_customer_id,
    target_customer_email,
    target_customer_name,
    target_customer_rnc
  )
  returning id into created_invoice_id;

  return created_invoice_id;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_items'
  ) then
    alter publication supabase_realtime add table public.inventory_items;
  end if;
end $$;
