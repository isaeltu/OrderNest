-- Incremental migration for updating items on an existing open order.
-- Run this after 202606180006_order_creation_guardrails.sql.

create or replace function public.replace_order_items(
  p_order_id uuid,
  p_items jsonb,
  p_status text default 'new'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  item jsonb;
  item_product_id uuid;
  item_quantity numeric;
  item_unit_price numeric;
begin
  target_restaurant_id := public.current_restaurant_id();

  if target_restaurant_id is null then
    raise exception 'Este usuario no tiene restaurante asignado.';
  end if;

  if not public.has_permission('CREATE_ORDER') then
    raise exception 'Este usuario no tiene permiso para crear ordenes.';
  end if;

  if p_status not in ('new', 'preparing', 'ready', 'delivered') then
    raise exception 'Estado de orden invalido.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden debe tener al menos un producto.';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.restaurant_id = target_restaurant_id
      and o.status <> 'paid'
  ) then
    raise exception 'La orden no pertenece a este restaurante o ya fue pagada.';
  end if;

  delete from public.order_items
  where order_id = p_order_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    item_product_id := nullif(item->>'productId', '')::uuid;
    item_quantity := coalesce(nullif(item->>'quantity', '')::numeric, 0);
    item_unit_price := coalesce(nullif(item->>'unitPrice', '')::numeric, 0);

    if item_product_id is null or item_quantity <= 0 then
      raise exception 'Producto o cantidad invalida en la orden.';
    end if;

    if not exists (
      select 1
      from public.products p
      where p.id = item_product_id
        and p.restaurant_id = target_restaurant_id
        and p.is_active = true
        and p.is_available = true
    ) then
      raise exception 'El producto % no pertenece a este restaurante o no esta disponible.', item_product_id;
    end if;

    insert into public.order_items (order_id, product_id, quantity, unit_price, notes)
    values (
      p_order_id,
      item_product_id,
      item_quantity,
      item_unit_price,
      nullif(item->>'notes', '')
    );
  end loop;

  update public.orders
  set status = p_status
  where id = p_order_id;

  perform public.recalculate_order_totals(p_order_id);

  return p_order_id;
end;
$$;
