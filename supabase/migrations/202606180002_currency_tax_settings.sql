-- Incremental migration for configurable currency and multiple taxes.
-- Run this after the previous schema and inventory/finance migration.

alter table public.business_settings
  add column if not exists currency_code text not null default 'DOP',
  add column if not exists currency_locale text not null default 'es-DO';

create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  rate numeric(7,6) not null default 0 check (rate >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tax_rules_updated_at') then
    create trigger tax_rules_updated_at before update on public.tax_rules
      for each row execute function public.set_updated_at();
  end if;
end $$;

insert into public.tax_rules (restaurant_id, name, rate, is_active)
select r.id, 'ITBIS', 0.18, true
from public.restaurants r
where not exists (
  select 1
  from public.tax_rules tr
  where tr.restaurant_id = r.id
)
on conflict (restaurant_id, name) do nothing;

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
      sum(
        (oi.quantity * oi.unit_price - oi.discount_amount)
        * coalesce((
          select sum(tr.rate)
          from public.tax_rules tr
          join public.orders tax_order on tax_order.id = oi.order_id
          where tr.restaurant_id = tax_order.restaurant_id
            and tr.is_active = true
        ), 0)
      ) as tax_total
    from public.order_items oi
    where oi.order_id = target_order_id
    group by oi.order_id
  ) t
  where o.id = t.order_id;
end;
$$;

alter table public.tax_rules enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tax_rules' and policyname = 'tax_rules_select') then
    create policy tax_rules_select on public.tax_rules
      for select using (restaurant_id = public.current_restaurant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tax_rules' and policyname = 'tax_rules_manage') then
    create policy tax_rules_manage on public.tax_rules
      for all using (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'))
      with check (restaurant_id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'));
  end if;
end $$;

create index if not exists idx_tax_rules_restaurant on public.tax_rules (restaurant_id, is_active);

update public.business_settings bs
set
  currency_code = coalesce(nullif(bs.currency_code, ''), 'DOP'),
  currency_locale = coalesce(nullif(bs.currency_locale, ''), 'es-DO');
