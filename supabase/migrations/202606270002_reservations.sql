-- Reservations module: a dedicated booking grid (floor x time) separate from
-- the existing free-form floor plan / "Mesas" screen. Reuses restaurant_tables
-- for the row labels (Bar, A1, A2...) instead of inventing a second concept
-- of "table" for this screen.

alter table public.restaurant_tables
  add column if not exists floor int not null default 1;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  title text,
  full_name text not null,
  phone text,
  email text,
  pax_number int not null default 1 check (pax_number > 0),
  reserve_date date not null,
  reservation_time time not null,
  deposit_fee numeric(12,2) not null default 0 check (deposit_fee >= 0),
  status text not null default 'awaited' check (status in ('confirmed', 'awaited', 'cancelled', 'failed')),
  payment_method text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reservations_restaurant_date on public.reservations (restaurant_id, reserve_date);
create index if not exists idx_reservations_table on public.reservations (table_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'reservations_updated_at') then
    create trigger reservations_updated_at before update on public.reservations
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.reservations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservations' and policyname = 'reservations_select') then
    create policy reservations_select on public.reservations
      for select using (restaurant_id = public.current_restaurant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservations' and policyname = 'reservations_manage') then
    create policy reservations_manage on public.reservations
      for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_RESERVATIONS'))
      with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_RESERVATIONS'));
  end if;
end $$;

insert into public.permissions (name, description) values
  ('MANAGE_RESERVATIONS', 'Gestionar reservaciones')
on conflict (name) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end $$;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name = 'MANAGE_RESERVATIONS'
where r.name in ('admin', 'waiter')
on conflict do nothing;

create or replace function public.create_reservation(
  p_table_id uuid,
  p_full_name text,
  p_pax_number int,
  p_reserve_date date,
  p_reservation_time time,
  p_title text default null,
  p_phone text default null,
  p_email text default null,
  p_deposit_fee numeric default 0,
  p_status text default 'confirmed',
  p_payment_method text default null,
  p_card_last4 text default null,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_reservation_id uuid;
  owning_restaurant_id uuid;
begin
  if not public.has_permission('MANAGE_RESERVATIONS') then
    raise exception 'Not allowed to manage reservations';
  end if;

  owning_restaurant_id := public.current_restaurant_id();

  if not exists (
    select 1 from public.restaurant_tables
    where id = p_table_id and restaurant_id = owning_restaurant_id
  ) then
    raise exception 'La mesa no pertenece a este restaurante.';
  end if;

  if p_full_name is null or trim(p_full_name) = '' then
    raise exception 'Debe indicar el nombre del cliente.';
  end if;

  insert into public.reservations (
    restaurant_id, table_id, customer_id, title, full_name, phone, email,
    pax_number, reserve_date, reservation_time, deposit_fee, status, payment_method, card_last4
  )
  values (
    owning_restaurant_id, p_table_id, p_customer_id, p_title, p_full_name, p_phone, p_email,
    coalesce(p_pax_number, 1), p_reserve_date, p_reservation_time, coalesce(p_deposit_fee, 0),
    coalesce(p_status, 'confirmed'), p_payment_method, p_card_last4
  )
  returning id into created_reservation_id;

  return created_reservation_id;
end;
$$;

create or replace function public.update_reservation_status(
  p_reservation_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('MANAGE_RESERVATIONS') then
    raise exception 'Not allowed to manage reservations';
  end if;

  if p_status not in ('confirmed', 'awaited', 'cancelled', 'failed') then
    raise exception 'Estado de reservacion invalido.';
  end if;

  update public.reservations
  set status = p_status
  where id = p_reservation_id and restaurant_id = public.current_restaurant_id();
end;
$$;

create or replace function public.change_reservation_table(
  p_reservation_id uuid,
  p_table_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_restaurant_id uuid;
begin
  if not public.has_permission('MANAGE_RESERVATIONS') then
    raise exception 'Not allowed to manage reservations';
  end if;

  owning_restaurant_id := public.current_restaurant_id();

  if not exists (
    select 1 from public.restaurant_tables
    where id = p_table_id and restaurant_id = owning_restaurant_id
  ) then
    raise exception 'La mesa no pertenece a este restaurante.';
  end if;

  update public.reservations
  set table_id = p_table_id
  where id = p_reservation_id and restaurant_id = owning_restaurant_id;
end;
$$;
