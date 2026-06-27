-- Lets the WhatsApp ordering bot capture the customer's name/email before creating an
-- order, and link that order to public.customers (same table the POS uses for invoices).

create or replace function public.bot_upsert_customer(
  p_phone_number_id text,
  p_full_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  normalized_email text;
  normalized_name text;
  created_customer_id uuid;
begin
  select b.restaurant_id into target_restaurant_id
  from public.restaurant_bot_settings b
  where b.whatsapp_phone_number_id = p_phone_number_id and b.is_enabled = true;

  if target_restaurant_id is null then
    raise exception 'Bot de WhatsApp no habilitado para este numero.';
  end if;

  normalized_email := lower(trim(coalesce(p_email, '')));
  if normalized_email = '' or normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo de cliente invalido.';
  end if;

  normalized_name := coalesce(nullif(trim(p_full_name), ''), normalized_email);

  insert into public.customers (restaurant_id, customer_type, full_name, email)
  values (target_restaurant_id, 'person', normalized_name, normalized_email)
  on conflict (restaurant_id, email) do update
  set full_name = coalesce(nullif(excluded.full_name, ''), public.customers.full_name)
  returning id into created_customer_id;

  return jsonb_build_object(
    'customerId', created_customer_id,
    'fullName', normalized_name,
    'email', normalized_email
  );
end;
$$;

revoke all on function public.bot_upsert_customer(text, text, text) from public;
grant execute on function public.bot_upsert_customer(text, text, text) to anon, authenticated;

-- bot_create_order now accepts the customer id resolved by bot_upsert_customer and links
-- the order to it, the same way orders created from the POS link to public.customers.
drop function if exists public.bot_create_order(text, text, text, jsonb);

create or replace function public.bot_create_order(
  p_phone_number_id text,
  p_customer_phone text,
  p_customer_name text,
  p_items jsonb,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  notification_email text;
  created_order_id uuid;
  created_order_number text;
  created_order_total numeric(10,2);
  item jsonb;
  item_product_id uuid;
  item_quantity numeric;
  item_unit_price numeric;
begin
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'Falta el telefono del cliente.';
  end if;

  select b.restaurant_id, b.notification_email into target_restaurant_id, notification_email
  from public.restaurant_bot_settings b
  where b.whatsapp_phone_number_id = p_phone_number_id and b.is_enabled = true;

  if target_restaurant_id is null then
    raise exception 'Bot de WhatsApp no habilitado para este numero.';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.restaurant_id = target_restaurant_id
  ) then
    raise exception 'El cliente no pertenece a este restaurante.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden debe tener al menos un producto.';
  end if;

  insert into public.orders (restaurant_id, table_id, status, channel, customer_phone, customer_display_name, customer_id)
  values (target_restaurant_id, null, 'new', 'whatsapp', p_customer_phone, p_customer_name, p_customer_id)
  returning id into created_order_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    item_product_id := nullif(item->>'productId', '')::uuid;
    item_quantity := coalesce(nullif(item->>'quantity', '')::numeric, 0);

    if item_product_id is null or item_quantity <= 0 then
      raise exception 'Producto o cantidad invalida en la orden.';
    end if;

    select price into item_unit_price
    from public.products
    where id = item_product_id
      and restaurant_id = target_restaurant_id
      and is_active = true
      and is_available = true;

    if item_unit_price is null then
      raise exception 'El producto % no pertenece a este restaurante o no esta disponible.', item_product_id;
    end if;

    insert into public.order_items (order_id, product_id, quantity, unit_price, notes)
    values (created_order_id, item_product_id, item_quantity, item_unit_price, nullif(item->>'notes', ''));
  end loop;

  perform public.recalculate_order_totals(created_order_id);

  select order_number, total into created_order_number, created_order_total
  from public.orders where id = created_order_id;

  return jsonb_build_object(
    'orderId', created_order_id,
    'orderNumber', created_order_number,
    'total', created_order_total,
    'notificationEmail', notification_email
  );
end;
$$;

revoke all on function public.bot_create_order(text, text, text, jsonb, uuid) from public;
grant execute on function public.bot_create_order(text, text, text, jsonb, uuid) to anon, authenticated;
