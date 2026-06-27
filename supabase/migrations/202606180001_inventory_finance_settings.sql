-- Incremental migration for installations that already ran
-- 202606170001_restaurant_pos_schema.sql before inventory/finance were added.

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  stock_quantity numeric(12,2) not null default 0 check (stock_quantity >= 0),
  reorder_level numeric(12,2) not null default 0 check (reorder_level >= 0),
  unit_cost numeric(10,2) not null default 0 check (unit_cost >= 0),
  supplier_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, product_id)
);

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  expense_date date not null default current_date,
  category text not null,
  expense_type text not null default 'operating'
    check (expense_type in ('operating', 'payroll', 'inventory', 'tax', 'other')),
  description text not null,
  amount numeric(10,2) not null check (amount >= 0),
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card', 'transfer', 'mixed')),
  vendor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  payment_date date not null default current_date,
  employee_name text not null,
  role_name text,
  amount numeric(10,2) not null check (amount >= 0),
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card', 'transfer', 'mixed', 'bank')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  billing_email text,
  invoice_sender_name text not null default 'RestoPOS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'inventory_items_updated_at') then
    create trigger inventory_items_updated_at before update on public.inventory_items
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'business_expenses_updated_at') then
    create trigger business_expenses_updated_at before update on public.business_expenses
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'employee_payments_updated_at') then
    create trigger employee_payments_updated_at before update on public.employee_payments
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'business_settings_updated_at') then
    create trigger business_settings_updated_at before update on public.business_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.report_profit_loss(
  p_start_date date default null,
  p_end_date date default null
)
returns table (expenses_total numeric, payroll_total numeric, net_profit numeric)
language sql
stable
security definer
set search_path = public
as $$
  with sales as (
    select coalesce(sum(total), 0) as total
    from public.orders
    where restaurant_id = public.current_restaurant_id()
      and status = 'paid'
      and (p_start_date is null or business_date >= p_start_date)
      and (p_end_date is null or business_date <= p_end_date)
  ),
  expenses as (
    select
      coalesce(sum(amount) filter (where expense_type <> 'payroll'), 0) as expenses_total,
      coalesce(sum(amount) filter (where expense_type = 'payroll'), 0) as payroll_expenses
    from public.business_expenses
    where restaurant_id = public.current_restaurant_id()
      and (p_start_date is null or expense_date >= p_start_date)
      and (p_end_date is null or expense_date <= p_end_date)
  ),
  payroll as (
    select coalesce(sum(amount), 0) as employee_total
    from public.employee_payments
    where restaurant_id = public.current_restaurant_id()
      and (p_start_date is null or payment_date >= p_start_date)
      and (p_end_date is null or payment_date <= p_end_date)
  )
  select
    expenses.expenses_total,
    expenses.payroll_expenses + payroll.employee_total,
    sales.total - expenses.expenses_total - expenses.payroll_expenses - payroll.employee_total
  from sales, expenses, payroll
$$;

alter table public.inventory_items enable row level security;
alter table public.business_expenses enable row level security;
alter table public.employee_payments enable row level security;
alter table public.business_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_items' and policyname = 'inventory_select') then
    create policy inventory_select on public.inventory_items
      for select using (restaurant_id = public.current_restaurant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_items' and policyname = 'inventory_manage') then
    create policy inventory_manage on public.inventory_items
      for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_INVENTORY'))
      with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_INVENTORY'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'business_expenses' and policyname = 'expenses_select') then
    create policy expenses_select on public.business_expenses
      for select using (restaurant_id = public.current_restaurant_id() and public.has_permission('VIEW_REPORTS'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'business_expenses' and policyname = 'expenses_manage') then
    create policy expenses_manage on public.business_expenses
      for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'))
      with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_payments' and policyname = 'employee_payments_select') then
    create policy employee_payments_select on public.employee_payments
      for select using (restaurant_id = public.current_restaurant_id() and public.has_permission('VIEW_REPORTS'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_payments' and policyname = 'employee_payments_manage') then
    create policy employee_payments_manage on public.employee_payments
      for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'))
      with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'business_settings' and policyname = 'business_settings_select') then
    create policy business_settings_select on public.business_settings
      for select using (restaurant_id = public.current_restaurant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'business_settings' and policyname = 'business_settings_manage') then
    create policy business_settings_manage on public.business_settings
      for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'))
      with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'));
  end if;
end $$;

create index if not exists idx_inventory_items_restaurant on public.inventory_items (restaurant_id, product_id);
create index if not exists idx_business_expenses_date on public.business_expenses (restaurant_id, expense_date);
create index if not exists idx_employee_payments_date on public.employee_payments (restaurant_id, payment_date);

insert into public.permissions (name, description) values
  ('MANAGE_INVENTORY', 'Gestionar inventario'),
  ('MANAGE_FINANCES', 'Gestionar gastos y nomina'),
  ('MANAGE_SETTINGS', 'Gestionar configuracion')
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
  and p.name in ('MANAGE_INVENTORY', 'MANAGE_FINANCES', 'MANAGE_SETTINGS')
on conflict do nothing;

insert into public.business_settings (restaurant_id, invoice_sender_name)
select id, name
from public.restaurants
on conflict (restaurant_id) do nothing;
