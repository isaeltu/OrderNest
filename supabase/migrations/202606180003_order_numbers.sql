-- Incremental migration for human-friendly order numbers per restaurant.
-- Keeps the UUID id for database relations, but shows order_number in the app.

alter table public.orders
  add column if not exists order_number text;

create unique index if not exists idx_orders_restaurant_order_number
  on public.orders (restaurant_id, order_number)
  where order_number is not null;

create or replace function public.generate_order_number(target_restaurant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  order_prefix text;
  next_number int;
begin
  order_prefix := 'ORD-' || to_char(current_date, 'YYYYMMDD') || '-';

  select coalesce(max(replace(order_number, order_prefix, '')::int), 0) + 1
  into next_number
  from public.orders
  where restaurant_id = target_restaurant_id
    and order_number like order_prefix || '%';

  return order_prefix || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.set_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_number is null or trim(new.order_number) = '' then
    new.order_number := public.generate_order_number(new.restaurant_id);
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'orders_set_order_number') then
    create trigger orders_set_order_number before insert on public.orders
      for each row execute function public.set_order_number();
  end if;
end $$;

with numbered_orders as (
  select
    id,
    'ORD-' || to_char(business_date, 'YYYYMMDD') || '-' ||
      lpad(row_number() over (
        partition by restaurant_id, business_date
        order by created_at, id
      )::text, 4, '0') as next_order_number
  from public.orders
  where order_number is null
)
update public.orders o
set order_number = numbered_orders.next_order_number
from numbered_orders
where o.id = numbered_orders.id;
