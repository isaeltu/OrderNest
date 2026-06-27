-- Adds order cancellation and a WhatsApp ordering bot integration (n8n + Meta Cloud API).

-- ---------------------------------------------------------------------------
-- Part 1: Cancel order
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('CANCEL_ORDER', 'Cancelar ordenes')
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name = 'CANCEL_ORDER'
where r.name in ('admin', 'cashier')
on conflict do nothing;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table_id uuid;
begin
  if not public.has_permission('CANCEL_ORDER') then
    raise exception 'Not allowed to cancel orders';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Debe indicar un motivo de cancelacion.';
  end if;

  select table_id into target_table_id
  from public.orders
  where id = p_order_id
    and restaurant_id = public.current_restaurant_id()
    and status <> 'paid';

  if not found then
    raise exception 'Order not found or already paid';
  end if;

  update public.orders
  set status = 'cancelled', cancel_reason = p_reason, closed_at = now()
  where id = p_order_id;

  if target_table_id is not null then
    update public.restaurant_tables
    set status = 'available'
    where id = target_table_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Part 2: WhatsApp ordering bot (n8n + Meta Cloud API)
-- ---------------------------------------------------------------------------

create table public.restaurant_bot_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  whatsapp_phone_number_id text unique,
  notification_email text,
  extra_prompt text not null default '',
  business_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger restaurant_bot_settings_updated_at before update on public.restaurant_bot_settings
  for each row execute function public.set_updated_at();

create table public.whatsapp_handoffs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_phone text not null,
  customer_name text,
  reason text,
  message_excerpt text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

alter table public.orders
  add column channel text not null default 'dine_in' check (channel in ('dine_in', 'whatsapp')),
  add column customer_phone text,
  add column customer_display_name text,
  alter column table_id drop not null;

alter table public.restaurant_bot_settings enable row level security;
alter table public.whatsapp_handoffs enable row level security;

create policy bot_settings_select on public.restaurant_bot_settings
  for select using (restaurant_id = public.current_restaurant_id());
create policy bot_settings_manage on public.restaurant_bot_settings
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'));

create policy whatsapp_handoffs_select on public.whatsapp_handoffs
  for select using (restaurant_id = public.current_restaurant_id());
create policy whatsapp_handoffs_update on public.whatsapp_handoffs
  for update using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

alter publication supabase_realtime add table public.whatsapp_handoffs;

-- Bot-facing functions. These are the ONLY entry points n8n is allowed to call
-- (granted to anon below); they resolve the restaurant from the WhatsApp
-- phone_number_id instead of relying on auth.uid(), since n8n calls them
-- without a logged-in Supabase session.

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
  p_items jsonb
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden debe tener al menos un producto.';
  end if;

  insert into public.orders (restaurant_id, table_id, status, channel, customer_phone, customer_display_name)
  values (target_restaurant_id, null, 'new', 'whatsapp', p_customer_phone, p_customer_name)
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

revoke all on function public.bot_get_menu(text) from public;
revoke all on function public.bot_create_order(text, text, text, jsonb) from public;
revoke all on function public.bot_create_handoff(text, text, text, text, text) from public;

grant execute on function public.bot_get_menu(text) to anon, authenticated;
grant execute on function public.bot_create_order(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.bot_create_handoff(text, text, text, text, text) to anon, authenticated;
