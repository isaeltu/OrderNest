-- Bug fix: update_kitchen_order_status raised "Order not found or already paid"
-- for every voice/whatsapp order, because table_id is intentionally NULL for
-- those (no physical table), and the function used "target_table_id is null"
-- to mean "order not found" -- the two cases were indistinguishable. This
-- blocked kitchen staff from ever marking call-in orders as preparing/ready.

create or replace function public.update_kitchen_order_status(
  p_order_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id uuid;
  target_table_id uuid;
  target_table_status text;
begin
  if public.current_role_name() not in ('admin', 'kitchen', 'waiter') then
    raise exception 'Not allowed to update kitchen orders';
  end if;

  if p_status not in ('new', 'preparing', 'ready', 'delivered') then
    raise exception 'Invalid kitchen status';
  end if;

  select id, table_id into target_order_id, target_table_id
  from public.orders
  where id = p_order_id
    and restaurant_id = public.current_restaurant_id()
    and status <> 'paid';

  if target_order_id is null then
    raise exception 'Order not found or already paid';
  end if;

  target_table_status := case
    when p_status = 'preparing' then 'kitchen'
    when p_status = 'ready' then 'ready'
    when p_status = 'delivered' then 'payment'
    else 'kitchen'
  end;

  update public.orders
  set status = p_status
  where id = p_order_id;

  if target_table_id is not null then
    update public.restaurant_tables
    set status = target_table_status
    where id = target_table_id;
  end if;
end;
$$;
