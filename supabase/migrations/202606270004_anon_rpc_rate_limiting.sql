-- The WhatsApp-bot RPCs (bot_get_menu/bot_create_order/bot_create_handoff/
-- bot_upsert_customer) authenticate by whatsapp_phone_number_id, which is not
-- a secret -- it's a public identifier, so anyone who learns/guesses it can
-- call these directly via PostgREST. The voice RPCs use a real secret
-- api_key, but nothing throttles repeated calls either way. This adds a
-- Postgres-native per-minute counter (no external service reachable from
-- plpgsql) and applies it at the top of all 7 anon-callable RPCs.

create table if not exists public.rate_limit_hits (
  rate_key text not null,
  window_start timestamptz not null,
  hit_count int not null default 1,
  primary key (rate_key, window_start)
);

alter table public.rate_limit_hits enable row level security;
-- No policies: only security-definer functions touch this table, so direct
-- PostgREST access (anon or authenticated) is denied by default.

create or replace function public.check_rate_limit(p_key text, p_max_per_minute int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz := date_trunc('minute', now());
  current_count int;
begin
  delete from public.rate_limit_hits where window_start < current_window - interval '10 minutes';

  insert into public.rate_limit_hits (rate_key, window_start, hit_count)
  values (p_key, current_window, 1)
  on conflict (rate_key, window_start) do update set hit_count = rate_limit_hits.hit_count + 1
  returning hit_count into current_count;

  if current_count > p_max_per_minute then
    raise exception 'Demasiadas solicitudes, intenta de nuevo en un momento.';
  end if;
end;
$$;

create or replace function public.bot_get_menu(p_phone_number_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant record;
  result jsonb;
begin
  perform public.check_rate_limit('bot_get_menu:' || p_phone_number_id, 60);

  select r.id, r.name, r.address, r.phone, b.extra_prompt, b.business_hours, b.notification_email
  into target_restaurant
  from public.restaurant_bot_settings b
  join public.restaurants r on r.id = b.restaurant_id
  where b.whatsapp_phone_number_id = p_phone_number_id
    and b.is_enabled = true
    and r.is_active = true;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', target_restaurant.id,
      'name', target_restaurant.name,
      'address', target_restaurant.address,
      'phone', target_restaurant.phone,
      'extraPrompt', target_restaurant.extra_prompt,
      'businessHours', target_restaurant.business_hours,
      'notificationEmail', target_restaurant.notification_email
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.display_order)
      from public.categories c
      where c.restaurant_id = target_restaurant.id and c.is_active = true
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'categoryId', p.category_id,
        'name', p.name,
        'description', p.description,
        'price', p.price
      ))
      from public.products p
      where p.restaurant_id = target_restaurant.id and p.is_active = true and p.is_available = true
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

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
  perform public.check_rate_limit('bot_create_order:' || p_phone_number_id, 10);

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

create or replace function public.bot_create_handoff(
  p_phone_number_id text,
  p_customer_phone text,
  p_customer_name text,
  p_reason text,
  p_message_excerpt text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  created_id uuid;
begin
  perform public.check_rate_limit('bot_create_handoff:' || p_phone_number_id, 10);

  select b.restaurant_id into target_restaurant_id
  from public.restaurant_bot_settings b
  where b.whatsapp_phone_number_id = p_phone_number_id and b.is_enabled = true;

  if target_restaurant_id is null then
    raise exception 'Bot de WhatsApp no habilitado para este numero.';
  end if;

  insert into public.whatsapp_handoffs (restaurant_id, customer_phone, customer_name, reason, message_excerpt)
  values (target_restaurant_id, p_customer_phone, p_customer_name, p_reason, p_message_excerpt)
  returning id into created_id;

  return created_id;
end;
$$;

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
  perform public.check_rate_limit('bot_upsert_customer:' || p_phone_number_id, 20);

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

create or replace function public.voice_get_menu(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant record;
  result jsonb;
begin
  perform public.check_rate_limit('voice_get_menu:' || p_api_key, 60);

  select r.id, r.name, r.address, r.phone, v.extra_prompt, v.notification_email
  into target_restaurant
  from public.restaurant_voice_settings v
  join public.restaurants r on r.id = v.restaurant_id
  where v.api_key = p_api_key
    and v.is_enabled = true
    and r.is_active = true;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', target_restaurant.id,
      'name', target_restaurant.name,
      'address', target_restaurant.address,
      'phone', target_restaurant.phone,
      'extraPrompt', target_restaurant.extra_prompt,
      'notificationEmail', target_restaurant.notification_email
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.display_order)
      from public.categories c
      where c.restaurant_id = target_restaurant.id and c.is_active = true
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'categoryId', p.category_id,
        'name', p.name,
        'description', p.description,
        'price', p.price
      ))
      from public.products p
      where p.restaurant_id = target_restaurant.id and p.is_active = true and p.is_available = true
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

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

  perform public.check_rate_limit('voice_create_order:' || p_api_key, 10);

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

create or replace function public.voice_log_call(
  p_api_key text,
  p_call_sid text,
  p_customer_phone text,
  p_transcript jsonb,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  linked_order_id uuid;
begin
  if p_api_key is null or trim(p_api_key) = '' then
    raise exception 'Falta la API key del restaurante.';
  end if;

  perform public.check_rate_limit('voice_log_call:' || p_api_key, 30);

  select v.restaurant_id into target_restaurant_id
  from public.restaurant_voice_settings v
  where v.api_key = p_api_key and v.is_enabled = true;

  if target_restaurant_id is null then
    raise exception 'API key invalida o bot de voz no habilitado para este restaurante.';
  end if;

  if p_call_sid is null or trim(p_call_sid) = '' then
    raise exception 'Falta el call_sid de la llamada.';
  end if;

  select id into linked_order_id from public.orders where call_sid = p_call_sid;

  insert into public.voice_call_logs (
    restaurant_id, call_sid, customer_phone, transcript, order_id, started_at, ended_at
  )
  values (
    target_restaurant_id, p_call_sid, p_customer_phone, coalesce(p_transcript, '[]'::jsonb),
    linked_order_id, coalesce(p_started_at, now()), p_ended_at
  )
  on conflict (call_sid) do update set
    customer_phone = excluded.customer_phone,
    transcript = excluded.transcript,
    order_id = coalesce(excluded.order_id, public.voice_call_logs.order_id),
    ended_at = excluded.ended_at;

  return jsonb_build_object('logged', true);
end;
$$;
