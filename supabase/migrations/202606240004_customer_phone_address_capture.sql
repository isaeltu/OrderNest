-- Lets customers be registered with just a phone number (no email), and adds
-- an address field. This is what makes voice-AI callers show up automatically
-- in the Clientes directory: the call only gives us name + phone + delivery
-- address, never an email.

alter table public.customers
  add column if not exists address text,
  alter column email drop not null;

alter table public.customers
  drop constraint if exists customers_restaurant_id_email_key;

drop index if exists idx_customers_restaurant_email;

create unique index if not exists idx_customers_restaurant_email
  on public.customers (restaurant_id, email)
  where email is not null;

create unique index if not exists idx_customers_restaurant_phone
  on public.customers (restaurant_id, phone)
  where phone is not null;

alter table public.customers
  drop constraint if exists customers_email_or_phone_check,
  add constraint customers_email_or_phone_check check (email is not null or phone is not null);

-- p_address is new; email is now optional as long as a phone is provided.
create or replace function public.upsert_customer(
  p_customer_type text,
  p_full_name text,
  p_email text,
  p_rnc text default null,
  p_phone text default null,
  p_notes text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  normalized_email text;
  normalized_phone text;
  normalized_type text;
  normalized_rnc text;
  normalized_address text;
  created_customer_id uuid;
begin
  target_restaurant_id := public.current_restaurant_id();
  normalized_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  normalized_phone := nullif(trim(coalesce(p_phone, '')), '');
  normalized_type := coalesce(nullif(trim(p_customer_type), ''), 'person');
  normalized_rnc := nullif(regexp_replace(coalesce(p_rnc, ''), '[^0-9]', '', 'g'), '');
  normalized_address := nullif(trim(coalesce(p_address, '')), '');

  if target_restaurant_id is null then
    raise exception 'Este usuario no tiene restaurante asignado.';
  end if;

  if not (
    public.has_permission('PROCESS_PAYMENT')
    or public.has_permission('MANAGE_SETTINGS')
    or public.has_permission('VIEW_REPORTS')
  ) then
    raise exception 'No tiene permiso para registrar clientes.';
  end if;

  if normalized_email is not null and normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo de cliente invalido.';
  end if;

  if normalized_email is null and normalized_phone is null then
    raise exception 'Debe indicar un correo o un telefono para registrar al cliente.';
  end if;

  if normalized_type not in ('person', 'company') then
    raise exception 'Tipo de cliente invalido.';
  end if;

  if normalized_type = 'company' and normalized_rnc is null then
    raise exception 'El RNC es obligatorio para clientes empresa.';
  end if;

  if normalized_email is not null then
    insert into public.customers (restaurant_id, customer_type, full_name, email, rnc, phone, notes, address)
    values (
      target_restaurant_id,
      normalized_type,
      coalesce(nullif(trim(p_full_name), ''), normalized_email),
      normalized_email,
      normalized_rnc,
      normalized_phone,
      nullif(trim(coalesce(p_notes, '')), ''),
      normalized_address
    )
    on conflict (restaurant_id, email) where email is not null do update
    set
      customer_type = excluded.customer_type,
      full_name = coalesce(nullif(excluded.full_name, ''), public.customers.full_name),
      rnc = coalesce(excluded.rnc, public.customers.rnc),
      phone = coalesce(excluded.phone, public.customers.phone),
      notes = coalesce(excluded.notes, public.customers.notes),
      address = coalesce(excluded.address, public.customers.address)
    returning id into created_customer_id;
  else
    insert into public.customers (restaurant_id, customer_type, full_name, email, rnc, phone, notes, address)
    values (
      target_restaurant_id,
      normalized_type,
      coalesce(nullif(trim(p_full_name), ''), normalized_phone),
      null,
      normalized_rnc,
      normalized_phone,
      nullif(trim(coalesce(p_notes, '')), ''),
      normalized_address
    )
    on conflict (restaurant_id, phone) where phone is not null do update
    set
      customer_type = excluded.customer_type,
      full_name = coalesce(nullif(excluded.full_name, ''), public.customers.full_name),
      rnc = coalesce(excluded.rnc, public.customers.rnc),
      notes = coalesce(excluded.notes, public.customers.notes),
      address = coalesce(excluded.address, public.customers.address)
    returning id into created_customer_id;
  end if;

  return created_customer_id;
end;
$$;

-- Same signature/behaviour as before, plus: every call auto-registers (or
-- refreshes) the caller in public.customers by phone, and links the new
-- order to that customer record straight away.
create or replace function public.voice_create_order(
  p_api_key text,
  p_restaurant_id uuid,
  p_call_sid text,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_delivery_type text,
  p_delivery_address text,
  p_special_instructions text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  existing_order_id uuid;
  existing_order_number text;
  created_order_id uuid;
  created_order_number text;
  created_order_total numeric(10,2);
  item jsonb;
  item_name text;
  item_quantity int;
  item_notes text;
  matched_product_id uuid;
  matched_product_name text;
  matched_product_price numeric;
  matched_score real;
  unavailable_items text[] := '{}';
  matched_count int := 0;
  final_instructions text;
  normalized_phone text;
  voice_customer_id uuid;
begin
  if p_api_key is null or trim(p_api_key) = '' then
    raise exception 'Falta la API key del restaurante.';
  end if;

  select v.restaurant_id into target_restaurant_id
  from public.restaurant_voice_settings v
  where v.api_key = p_api_key and v.is_enabled = true;

  if target_restaurant_id is null then
    raise exception 'API key invalida o bot de voz no habilitado para este restaurante.';
  end if;

  if p_restaurant_id is not null and p_restaurant_id <> target_restaurant_id then
    raise exception 'El restaurant_id no coincide con la API key utilizada.';
  end if;

  -- Idempotency: a retried webhook for the same call must not create a second order.
  if p_call_sid is not null and trim(p_call_sid) <> '' then
    select id, order_number into existing_order_id, existing_order_number
    from public.orders
    where call_sid = p_call_sid;

    if existing_order_id is not null then
      return jsonb_build_object(
        'orderId', existing_order_id,
        'orderNumber', existing_order_number,
        'duplicate', true
      );
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener al menos un producto.';
  end if;

  if p_delivery_type is not null and p_delivery_type not in ('pickup', 'delivery') then
    raise exception 'delivery_type debe ser pickup o delivery.';
  end if;

  if p_delivery_type = 'delivery' and (p_delivery_address is null or trim(p_delivery_address) = '') then
    raise exception 'Falta la direccion de entrega.';
  end if;

  -- Auto-register the caller as a customer (keyed by phone, since the call
  -- never gives us an email) so they show up in Clientes without any manual
  -- step from the cashier.
  normalized_phone := nullif(trim(coalesce(p_customer_phone, '')), '');
  if normalized_phone is not null then
    insert into public.customers (restaurant_id, customer_type, full_name, phone, address)
    values (
      target_restaurant_id,
      'person',
      coalesce(nullif(trim(p_customer_name), ''), normalized_phone),
      normalized_phone,
      nullif(trim(coalesce(p_delivery_address, '')), '')
    )
    on conflict (restaurant_id, phone) where phone is not null do update
    set
      full_name = coalesce(nullif(excluded.full_name, ''), public.customers.full_name),
      address = coalesce(excluded.address, public.customers.address)
    returning id into voice_customer_id;
  end if;

  insert into public.orders (
    restaurant_id, table_id, status, channel, customer_phone, customer_display_name,
    call_sid, delivery_type, delivery_address, special_instructions, customer_id
  )
  values (
    target_restaurant_id, null, 'new', 'voice', p_customer_phone, p_customer_name,
    p_call_sid, p_delivery_type, p_delivery_address, p_special_instructions, voice_customer_id
  )
  returning id into created_order_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    item_name := trim(coalesce(item->>'name', ''));
    item_quantity := coalesce(nullif(item->>'quantity', '')::int, 0);
    item_notes := nullif(item->>'notes', '');
    matched_product_id := null;
    matched_product_name := null;
    matched_product_price := null;
    matched_score := 0;

    if item_name = '' or item_quantity <= 0 then
      continue;
    end if;

    -- Fuzzy match the spoken item name against this restaurant's live menu
    -- (pg_trgm trigram similarity); below the threshold it is "not available".
    select p.id, p.name, p.price, similarity(lower(p.name), lower(item_name))
    into matched_product_id, matched_product_name, matched_product_price, matched_score
    from public.products p
    where p.restaurant_id = target_restaurant_id
      and p.is_active = true
      and p.is_available = true
    order by similarity(lower(p.name), lower(item_name)) desc
    limit 1;

    if matched_product_id is null or matched_score < 0.3 then
      unavailable_items := array_append(unavailable_items, item->>'name');
      continue;
    end if;

    insert into public.order_items (order_id, product_id, quantity, unit_price, notes)
    values (created_order_id, matched_product_id, item_quantity, matched_product_price, item_notes);

    matched_count := matched_count + 1;
  end loop;

  if matched_count = 0 then
    delete from public.orders where id = created_order_id;
    raise exception 'No se pudo identificar ningun producto del menu en el pedido.';
  end if;

  if array_length(unavailable_items, 1) > 0 then
    final_instructions := trim(both ' | ' from concat_ws(' | ', p_special_instructions,
      'No disponibles: ' || array_to_string(unavailable_items, ', ')));
    update public.orders set special_instructions = final_instructions where id = created_order_id;
  end if;

  perform public.recalculate_order_totals(created_order_id);

  select order_number, total into created_order_number, created_order_total
  from public.orders where id = created_order_id;

  return jsonb_build_object(
    'orderId', created_order_id,
    'orderNumber', created_order_number,
    'total', created_order_total,
    'unavailableItems', to_jsonb(unavailable_items)
  );
end;
$$;

revoke all on function public.voice_create_order(text, uuid, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.voice_create_order(text, uuid, text, text, text, jsonb, text, text, text) to anon, authenticated;
