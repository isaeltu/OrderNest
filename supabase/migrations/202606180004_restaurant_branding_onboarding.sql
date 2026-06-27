-- Incremental migration for restaurant branding and onboarding.
-- UUID ids remain internal; restaurant data is used for branding and invoices.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurants' and policyname = 'restaurants_update_current') then
    create policy restaurants_update_current on public.restaurants
      for update using (id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'))
      with check (id = public.current_restaurant_id() and public.has_permission('MANAGE_SETTINGS'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurants' and policyname = 'restaurants_create_select') then
    create policy restaurants_create_select on public.restaurants
      for select using (id = public.current_restaurant_id() or public.has_permission('CREATE_RESTAURANT'));
  end if;
end $$;

create or replace function public.create_restaurant(
  p_name text,
  p_rnc text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_logo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_restaurant_id uuid;
begin
  if not public.has_permission('CREATE_RESTAURANT') then
    raise exception 'Not allowed to create restaurants';
  end if;

  insert into public.restaurants (name, rnc, phone, email, address, logo_url)
  values (p_name, p_rnc, p_phone, p_email, p_address, p_logo_url)
  returning id into created_restaurant_id;

  insert into public.business_settings (restaurant_id, billing_email, invoice_sender_name)
  values (created_restaurant_id, p_email, p_name)
  on conflict (restaurant_id) do nothing;

  insert into public.tax_rules (restaurant_id, name, rate, is_active)
  values (created_restaurant_id, 'ITBIS', 0.18, true)
  on conflict (restaurant_id, name) do nothing;

  return created_restaurant_id;
end;
$$;
