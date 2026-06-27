-- Incremental migration for restaurant customers and invoice history.
-- Customers are unique by email per restaurant.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_type text not null default 'person' check (customer_type in ('person', 'company')),
  full_name text not null,
  email text not null,
  rnc text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, email)
);

alter table public.orders
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

alter table public.invoices
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_rnc text;

alter table public.customers
  add column if not exists customer_type text not null default 'person' check (customer_type in ('person', 'company')),
  add column if not exists rnc text;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'customers_updated_at') then
    create trigger customers_updated_at before update on public.customers
      for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.upsert_customer(
  p_customer_type text,
  p_full_name text,
  p_email text,
  p_rnc text default null,
  p_phone text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  normalized_email text;
  normalized_type text;
  normalized_rnc text;
  created_customer_id uuid;
begin
  target_restaurant_id := public.current_restaurant_id();
  normalized_email := lower(trim(p_email));
  normalized_type := coalesce(nullif(trim(p_customer_type), ''), 'person');
  normalized_rnc := nullif(regexp_replace(coalesce(p_rnc, ''), '[^0-9]', '', 'g'), '');

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

  if normalized_email = '' or normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo de cliente invalido.';
  end if;

  if normalized_type not in ('person', 'company') then
    raise exception 'Tipo de cliente invalido.';
  end if;

  if normalized_type = 'company' and normalized_rnc is null then
    raise exception 'El RNC es obligatorio para clientes empresa.';
  end if;

  insert into public.customers (restaurant_id, customer_type, full_name, email, rnc, phone, notes)
  values (
    target_restaurant_id,
    normalized_type,
    coalesce(nullif(trim(p_full_name), ''), normalized_email),
    normalized_email,
    normalized_rnc,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  on conflict (restaurant_id, email) do update
  set
    customer_type = excluded.customer_type,
    full_name = coalesce(nullif(excluded.full_name, ''), public.customers.full_name),
    rnc = coalesce(excluded.rnc, public.customers.rnc),
    phone = coalesce(excluded.phone, public.customers.phone),
    notes = coalesce(excluded.notes, public.customers.notes)
  returning id into created_customer_id;

  return created_customer_id;
end;
$$;

create or replace function public.assign_order_customer(
  p_order_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('PROCESS_PAYMENT')
    or public.has_permission('CREATE_ORDER')
    or public.has_permission('MANAGE_SETTINGS')
  ) then
    raise exception 'No tiene permiso para asignar clientes.';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and c.restaurant_id = public.current_restaurant_id()
  ) then
    raise exception 'El cliente no pertenece a este restaurante.';
  end if;

  update public.orders
  set customer_id = p_customer_id
  where id = p_order_id
    and restaurant_id = public.current_restaurant_id()
    and status <> 'paid';
end;
$$;

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
begin
  if not public.has_permission('PROCESS_PAYMENT') then
    raise exception 'Not allowed to process payments';
  end if;

  select o.total, o.customer_id
  into order_total, target_customer_id
  from public.orders o
  where o.id = p_order_id
    and o.restaurant_id = public.current_restaurant_id()
    and o.status <> 'paid';

  if order_total is null then
    raise exception 'Order not found or already paid';
  end if;

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
    and c.restaurant_id = public.current_restaurant_id();

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

alter table public.customers enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers_select') then
    create policy customers_select on public.customers
      for select using (restaurant_id = public.current_restaurant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers_manage') then
    create policy customers_manage on public.customers
      for all using (
        restaurant_id = public.current_restaurant_id()
        and (
          public.has_permission('PROCESS_PAYMENT')
          or public.has_permission('MANAGE_SETTINGS')
          or public.has_permission('VIEW_REPORTS')
        )
      )
      with check (
        restaurant_id = public.current_restaurant_id()
        and (
          public.has_permission('PROCESS_PAYMENT')
          or public.has_permission('MANAGE_SETTINGS')
          or public.has_permission('VIEW_REPORTS')
        )
      );
  end if;
end $$;

create index if not exists idx_customers_restaurant_email on public.customers (restaurant_id, email);
create index if not exists idx_orders_customer on public.orders (customer_id);
create index if not exists idx_invoices_customer on public.invoices (customer_id);
