-- Weighted products and thermal printer preferences.

alter table public.products
  add column if not exists sale_unit text not null default 'unit'
  check (sale_unit in ('unit', 'lb'));

alter table public.order_items
  alter column quantity type numeric(12,3) using quantity::numeric;

alter table public.business_settings
  add column if not exists printer_mode text not null default 'system'
    check (printer_mode in ('system', 'bridge')),
  add column if not exists printer_endpoint text;

drop function if exists public.report_top_products(date, date, text, text, int, text);

create function public.report_top_products(
  p_start_date date default null,
  p_end_date date default null,
  p_status text default null,
  p_payment_method text default null,
  p_table_number int default null,
  p_waiter_name text default null
)
returns table (product_id uuid, product_name text, quantity numeric, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, coalesce(sum(oi.quantity), 0), coalesce(sum(oi.subtotal), 0)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  join public.restaurant_tables t on t.id = o.table_id
  left join public.payments pay on pay.order_id = o.id
  left join public.profiles waiter on waiter.id = o.waiter_id
  where o.restaurant_id = public.current_restaurant_id()
    and (p_start_date is null or o.business_date >= p_start_date)
    and (p_end_date is null or o.business_date <= p_end_date)
    and (p_status is null or o.status = p_status)
    and (p_payment_method is null or pay.payment_method = p_payment_method)
    and (p_table_number is null or t.number = p_table_number)
    and (p_waiter_name is null or waiter.full_name = p_waiter_name)
  group by p.id, p.name
  order by coalesce(sum(oi.subtotal), 0) desc
  limit 20
$$;

