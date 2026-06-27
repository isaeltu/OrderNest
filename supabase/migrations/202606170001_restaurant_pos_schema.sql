create extension if not exists pgcrypto;

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rnc text,
  phone text,
  email text,
  address text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  full_name text,
  role_id uuid references public.roles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  number int not null,
  name text,
  capacity int not null default 4,
  status text not null default 'available'
    check (status in ('available', 'occupied', 'kitchen', 'ready', 'payment', 'reserved', 'out')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, number)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  price numeric(10,2) not null check (price > 0),
  image_url text,
  is_available boolean not null default true,
  is_active boolean not null default true,
  estimated_minutes int not null default 10,
  tax_rate numeric(5,4) not null default 0.18,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  waiter_id uuid references public.profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'new', 'preparing', 'ready', 'delivered', 'paid', 'cancelled')),
  subtotal numeric(10,2) not null default 0,
  discount_total numeric(10,2) not null default 0,
  tax_total numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  business_date date not null default current_date,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index one_active_order_per_table
  on public.orders(table_id)
  where status in ('draft', 'new', 'preparing', 'ready', 'delivered');

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  discount_amount numeric(10,2) not null default 0,
  notes text,
  subtotal numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  start_date timestamptz,
  end_date timestamptz,
  usage_limit int,
  used_count int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, code)
);

create table public.coupon_products (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (coupon_id, product_id)
);

create table public.coupon_categories (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (coupon_id, category_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  cashier_id uuid references public.profiles(id) on delete set null,
  payment_method text not null check (payment_method in ('cash', 'card', 'transfer', 'mixed')),
  amount_paid numeric(10,2) not null check (amount_paid >= 0),
  change_amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  invoice_number text not null unique,
  customer_email text,
  customer_name text,
  pdf_url text,
  sent_email boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.cash_register_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  cashier_id uuid references public.profiles(id) on delete set null,
  opening_amount numeric(10,2) not null default 0,
  closing_amount numeric(10,2),
  expected_amount numeric(10,2),
  difference numeric(10,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed'))
);

create table public.inventory_items (
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

create table public.business_expenses (
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

create table public.employee_payments (
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

create table public.business_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  billing_email text,
  invoice_sender_name text not null default 'RestoPOS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_name text,
  entity_id uuid,
  description text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger restaurants_updated_at before update on public.restaurants
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger tables_updated_at before update on public.restaurant_tables
  for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger coupons_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();
create trigger inventory_items_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();
create trigger business_expenses_updated_at before update on public.business_expenses
  for each row execute function public.set_updated_at();
create trigger employee_payments_updated_at before update on public.employee_payments
  for each row execute function public.set_updated_at();
create trigger business_settings_updated_at before update on public.business_settings
  for each row execute function public.set_updated_at();

create or replace function public.current_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurant_id from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.is_active = true
$$;

create or replace function public.has_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.id = auth.uid()
      and p.is_active = true
      and perm.name = permission_name
  )
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_role_id uuid;
  target_restaurant_id uuid;
begin
  select id into default_role_id from public.roles where name = coalesce(new.raw_user_meta_data->>'role', 'waiter') limit 1;
  target_restaurant_id := nullif(new.raw_user_meta_data->>'restaurant_id', '')::uuid;

  insert into public.profiles (id, restaurant_id, full_name, role_id)
  values (
    new.id,
    target_restaurant_id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    default_role_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.recalculate_order_totals(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders o
  set
    subtotal = coalesce(t.subtotal, 0),
    discount_total = coalesce(t.discount_total, 0),
    tax_total = coalesce(t.tax_total, 0),
    total = coalesce(t.subtotal, 0) - coalesce(t.discount_total, 0) + coalesce(t.tax_total, 0)
  from (
    select
      oi.order_id,
      sum(oi.quantity * oi.unit_price) as subtotal,
      sum(oi.discount_amount) as discount_total,
      sum((oi.quantity * oi.unit_price - oi.discount_amount) * p.tax_rate) as tax_total
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = target_order_id
    group by oi.order_id
  ) t
  where o.id = t.order_id;
end;
$$;

create or replace function public.update_order_item_subtotal()
returns trigger
language plpgsql
as $$
begin
  new.subtotal = (new.quantity * new.unit_price) - new.discount_amount;
  return new;
end;
$$;

create trigger order_item_subtotal before insert or update on public.order_items
  for each row execute function public.update_order_item_subtotal();

create or replace function public.sync_order_totals_from_items()
returns trigger
language plpgsql
as $$
declare
  target_order_id uuid;
begin
  target_order_id := coalesce(new.order_id, old.order_id);
  perform public.recalculate_order_totals(target_order_id);
  return coalesce(new, old);
end;
$$;

create trigger order_items_sync_totals after insert or update or delete on public.order_items
  for each row execute function public.sync_order_totals_from_items();

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
begin
  if not public.has_permission('PROCESS_PAYMENT') then
    raise exception 'Not allowed to process payments';
  end if;

  select total into order_total
  from public.orders
  where id = p_order_id
    and restaurant_id = public.current_restaurant_id()
    and status <> 'paid';

  if order_total is null then
    raise exception 'Order not found or already paid';
  end if;

  insert into public.payments (order_id, cashier_id, payment_method, amount_paid, change_amount)
  values (p_order_id, auth.uid(), p_payment_method, p_amount_paid, greatest(p_amount_paid - order_total, 0));

  update public.orders
  set status = 'paid', closed_at = now()
  where id = p_order_id;

  update public.restaurant_tables t
  set status = 'available'
  from public.orders o
  where o.id = p_order_id and t.id = o.table_id;

  insert into public.invoices (order_id, invoice_number, customer_email, customer_name)
  values (
    p_order_id,
    'FAC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    p_customer_email,
    p_customer_name
  )
  returning id into created_invoice_id;

  return created_invoice_id;
end;
$$;

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
  target_table_id uuid;
  target_table_status text;
begin
  if public.current_role_name() not in ('admin', 'kitchen', 'waiter') then
    raise exception 'Not allowed to update kitchen orders';
  end if;

  if p_status not in ('new', 'preparing', 'ready', 'delivered') then
    raise exception 'Invalid kitchen status';
  end if;

  select table_id into target_table_id
  from public.orders
  where id = p_order_id
    and restaurant_id = public.current_restaurant_id()
    and status <> 'paid';

  if target_table_id is null then
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

  update public.restaurant_tables
  set status = target_table_status
  where id = target_table_id;
end;
$$;

create or replace function public.report_sales_summary(
  p_start_date date default null,
  p_end_date date default null,
  p_status text default null,
  p_payment_method text default null,
  p_table_number int default null,
  p_waiter_name text default null
)
returns table (
  subtotal numeric,
  discount_total numeric,
  tax_total numeric,
  total numeric,
  order_count bigint,
  average_ticket numeric,
  cash_total numeric,
  card_total numeric,
  transfer_total numeric,
  mixed_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(o.subtotal), 0),
    coalesce(sum(o.discount_total), 0),
    coalesce(sum(o.tax_total), 0),
    coalesce(sum(o.total), 0),
    count(o.id),
    coalesce(avg(o.total), 0),
    coalesce(sum(o.total) filter (where pay.payment_method = 'cash'), 0),
    coalesce(sum(o.total) filter (where pay.payment_method = 'card'), 0),
    coalesce(sum(o.total) filter (where pay.payment_method = 'transfer'), 0),
    coalesce(sum(o.total) filter (where pay.payment_method = 'mixed'), 0)
  from public.orders o
  join public.restaurant_tables t on t.id = o.table_id
  left join public.payments pay on pay.order_id = o.id
  left join public.profiles waiter on waiter.id = o.waiter_id
  where o.restaurant_id = public.current_restaurant_id()
    and (p_start_date is null or o.business_date >= p_start_date)
    and (p_end_date is null or o.business_date <= p_end_date)
    and (p_status is null or o.status = p_status)
    and (p_payment_method is null or pay.payment_method = p_payment_method)
    and (p_table_number is null or t.number = p_table_number)
    and (p_waiter_name is null or waiter.full_name = p_waiter_name)
$$;

create or replace function public.report_sales_by_day(
  p_start_date date default null,
  p_end_date date default null,
  p_status text default null,
  p_payment_method text default null,
  p_table_number int default null,
  p_waiter_name text default null
)
returns table (business_date date, total numeric, order_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select o.business_date, coalesce(sum(o.total), 0), count(o.id)
  from public.orders o
  join public.restaurant_tables t on t.id = o.table_id
  left join public.payments pay on pay.order_id = o.id
  left join public.profiles waiter on waiter.id = o.waiter_id
  where o.restaurant_id = public.current_restaurant_id()
    and (p_start_date is null or o.business_date >= p_start_date)
    and (p_end_date is null or o.business_date <= p_end_date)
    and (p_status is null or o.status = p_status)
    and (p_payment_method is null or pay.payment_method = p_payment_method)
    and (p_table_number is null or t.number = p_table_number)
    and (p_waiter_name is null or waiter.full_name = p_waiter_name)
  group by o.business_date
  order by o.business_date
$$;

create or replace function public.report_top_products(
  p_start_date date default null,
  p_end_date date default null,
  p_status text default null,
  p_payment_method text default null,
  p_table_number int default null,
  p_waiter_name text default null
)
returns table (product_id uuid, product_name text, quantity bigint, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, coalesce(sum(oi.quantity), 0), coalesce(sum(oi.subtotal), 0)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  join public.restaurant_tables t on t.id = o.table_id
  left join public.payments pay on pay.order_id = o.id
  left join public.profiles waiter on waiter.id = o.waiter_id
  where o.restaurant_id = public.current_restaurant_id()
    and (p_start_date is null or o.business_date >= p_start_date)
    and (p_end_date is null or o.business_date <= p_end_date)
    and (p_status is null or o.status = p_status)
    and (p_payment_method is null or pay.payment_method = p_payment_method)
    and (p_table_number is null or t.number = p_table_number)
    and (p_waiter_name is null or waiter.full_name = p_waiter_name)
  group by p.id, p.name
  order by coalesce(sum(oi.subtotal), 0) desc
  limit 20
$$;

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

alter table public.restaurants enable row level security;
alter table public.profiles enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_products enable row level security;
alter table public.coupon_categories enable row level security;
alter table public.payments enable row level security;
alter table public.invoices enable row level security;
alter table public.cash_register_sessions enable row level security;
alter table public.inventory_items enable row level security;
alter table public.business_expenses enable row level security;
alter table public.employee_payments enable row level security;
alter table public.business_settings enable row level security;
alter table public.activity_logs enable row level security;

create policy restaurants_same_restaurant on public.restaurants
  for select using (id = public.current_restaurant_id());

create policy profiles_same_restaurant on public.profiles
  for select using (restaurant_id = public.current_restaurant_id() or id = auth.uid());

create policy tables_select on public.restaurant_tables
  for select using (restaurant_id = public.current_restaurant_id());
create policy tables_manage on public.restaurant_tables
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_TABLES'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_TABLES'));

create policy categories_select on public.categories
  for select using (restaurant_id = public.current_restaurant_id());
create policy categories_manage on public.categories
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_CATEGORIES'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_CATEGORIES'));

create policy products_select on public.products
  for select using (restaurant_id = public.current_restaurant_id());
create policy products_manage on public.products
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_PRODUCTS'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_PRODUCTS'));

create policy orders_select on public.orders
  for select using (restaurant_id = public.current_restaurant_id());
create policy orders_create on public.orders
  for insert with check (restaurant_id = public.current_restaurant_id() and public.has_permission('CREATE_ORDER'));
create policy orders_update on public.orders
  for update using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

create policy order_items_select on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.restaurant_id = public.current_restaurant_id()
    )
  );
create policy order_items_manage on public.order_items
  for all using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
        and public.has_permission('CREATE_ORDER')
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
        and public.has_permission('CREATE_ORDER')
    )
  );

create policy coupons_select on public.coupons
  for select using (restaurant_id = public.current_restaurant_id());
create policy coupons_manage on public.coupons
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_COUPONS'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_COUPONS'));

create policy payments_select on public.payments
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id and o.restaurant_id = public.current_restaurant_id()
    )
  );
create policy payments_insert on public.payments
  for insert with check (
    public.has_permission('PROCESS_PAYMENT')
    and exists (
      select 1 from public.orders o
      where o.id = payments.order_id and o.restaurant_id = public.current_restaurant_id()
    )
  );

create policy invoices_select on public.invoices
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = invoices.order_id and o.restaurant_id = public.current_restaurant_id()
    )
  );

create policy cash_sessions_select on public.cash_register_sessions
  for select using (restaurant_id = public.current_restaurant_id());
create policy cash_sessions_manage on public.cash_register_sessions
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('CLOSE_CASH_REGISTER'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('CLOSE_CASH_REGISTER'));

create policy inventory_select on public.inventory_items
  for select using (restaurant_id = public.current_restaurant_id());
create policy inventory_manage on public.inventory_items
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_INVENTORY'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_INVENTORY'));

create policy expenses_select on public.business_expenses
  for select using (restaurant_id = public.current_restaurant_id() and public.has_permission('VIEW_REPORTS'));
create policy expenses_manage on public.business_expenses
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'));

create policy employee_payments_select on public.employee_payments
  for select using (restaurant_id = public.current_restaurant_id() and public.has_permission('VIEW_REPORTS'));
create policy employee_payments_manage on public.employee_payments
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_FINANCES'));

create policy business_settings_select on public.business_settings
  for select using (restaurant_id = public.current_restaurant_id());
create policy business_settings_manage on public.business_settings
  for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'));

create policy logs_select on public.activity_logs
  for select using (restaurant_id = public.current_restaurant_id() and public.has_permission('VIEW_LOGS'));

create index idx_orders_restaurant_date on public.orders (restaurant_id, business_date);
create index idx_orders_status on public.orders (restaurant_id, status);
create index idx_payments_method on public.payments (payment_method, created_at);
create index idx_order_items_order on public.order_items (order_id);
create index idx_products_category on public.products (category_id);
create index idx_inventory_items_restaurant on public.inventory_items (restaurant_id, product_id);
create index idx_business_expenses_date on public.business_expenses (restaurant_id, expense_date);
create index idx_employee_payments_date on public.employee_payments (restaurant_id, payment_date);

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.restaurant_tables;
