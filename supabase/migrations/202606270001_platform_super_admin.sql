-- Locks restaurant registration down to a single platform super admin.
-- Today ANY user with the per-restaurant "admin" role can create new
-- restaurants and list every restaurant on the platform, because the seed
-- grants every permission (including CREATE_RESTAURANT) to the "admin" role
-- via a cross join (supabase/seed.sql). That's a cross-tenant leak: a
-- restaurant owner could see/create rows for other restaurants. This adds a
-- real platform-level gate, independent of the per-restaurant role system.

create or replace function public.is_platform_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'isaelcapellanlite@gmail.com'
$$;

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
  if not public.is_platform_super_admin() then
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

drop policy if exists restaurants_create_select on public.restaurants;
create policy restaurants_create_select on public.restaurants
  for select using (id = public.current_restaurant_id() or public.is_platform_super_admin());

drop policy if exists restaurant_logos_insert on storage.objects;
create policy restaurant_logos_insert on storage.objects
  for insert with check (
    bucket_id = 'restaurant-logos'
    and (
      public.has_permission('MANAGE_SETTINGS')
      or public.is_platform_super_admin()
    )
  );

drop policy if exists restaurant_logos_update on storage.objects;
create policy restaurant_logos_update on storage.objects
  for update using (
    bucket_id = 'restaurant-logos'
    and (
      public.has_permission('MANAGE_SETTINGS')
      or public.is_platform_super_admin()
    )
  )
  with check (
    bucket_id = 'restaurant-logos'
    and (
      public.has_permission('MANAGE_SETTINGS')
      or public.is_platform_super_admin()
    )
  );

drop policy if exists restaurant_logos_delete on storage.objects;
create policy restaurant_logos_delete on storage.objects
  for delete using (
    bucket_id = 'restaurant-logos'
    and (
      public.has_permission('MANAGE_SETTINGS')
      or public.is_platform_super_admin()
    )
  );

create or replace function public.set_restaurant_logo(
  p_restaurant_id uuid,
  p_logo_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_restaurant_id = public.current_restaurant_id() then
    if not public.has_permission('MANAGE_SETTINGS') then
      raise exception 'Not allowed to update restaurant logo';
    end if;
  elsif not public.is_platform_super_admin() then
    raise exception 'Not allowed to update restaurant logo';
  end if;

  update public.restaurants
  set logo_url = nullif(p_logo_url, '')
  where id = p_restaurant_id;
end;
$$;
