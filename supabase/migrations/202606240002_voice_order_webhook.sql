-- Adds a webhook entry point for phone orders taken by a voice AI agent
-- (e.g. Twilio + LLM). The agent already resolves customer/items and POSTs a
-- finished order; this migration adds the storage, fuzzy product matching and
-- the security-definer function the Edge Function `voice-order-webhook` calls.

create extension if not exists pg_trgm;

create table public.restaurant_voice_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  api_key text not null unique default ('voice_' || encode(gen_random_bytes(24), 'hex')),
  notification_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger restaurant_voice_settings_updated_at before update on public.restaurant_voice_settings
  for each row execute function public.set_updated_at();

alter table public.restaurant_voice_settings enable row level security;

create policy voice_settings_select on public.restaurant_voice_settings
  for select using (restaurant_id = public.current_restaurant_id());
create policy voice_settings_manage on public.restaurant_voice_settings
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'));

alter table public.orders
  drop constraint if exists orders_channel_check,
  add column if not exists call_sid text,
  add column if not exists delivery_type text check (delivery_type in ('pickup', 'delivery')),
  add column if not exists delivery_address text,
  add column if not exists special_instructions text;

alter table public.orders
  add constraint orders_channel_check check (channel in ('dine_in', 'whatsapp', 'voice'));

create unique index if not exists idx_orders_call_sid
  on public.orders (call_sid)
  where call_sid is not null;

-- Lets an authenticated admin (MANAGE_SETTINGS) rotate the webhook secret for
-- their own restaurant from the app, without exposing other restaurants' keys.
create or replace function public.regenerate_voice_api_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  new_key text;
begin
  target_restaurant_id := public.current_restaurant_id();

  if target_restaurant_id is null or not public.has_permission('MANAGE_SETTINGS') then
    raise exception 'No tiene permiso para regenerar la API key de voz.';
  end if;

  new_key := 'voice_' || encode(gen_random_bytes(24), 'hex');

  insert into public.restaurant_voice_settings (restaurant_id, api_key)
  values (target_restaurant_id, new_key)
  on conflict (restaurant_id) do update set api_key = excluded.api_key;

  return new_key;
end;
$$;

-- Voice-agent-facing function. This is the only entry point the webhook is
-- allowed to call (granted to anon below); it resolves the restaurant from
-- the per-restaurant api_key instead of relying on auth.uid(), since the
-- voice platform calls it without a logged-in Supabase session. The
-- Authorization: Bearer header carries that api_key, validated here.
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

  insert into public.orders (
    restaurant_id, table_id, status, channel, customer_phone, customer_display_name,
    call_sid, delivery_type, delivery_address, special_instructions
  )
  values (
    target_restaurant_id, null, 'new', 'voice', p_customer_phone, p_customer_name,
    p_call_sid, p_delivery_type, p_delivery_address, p_special_instructions
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

revoke all on function public.regenerate_voice_api_key() from public;
grant execute on function public.regenerate_voice_api_key() to authenticated;
