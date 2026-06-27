-- Incremental migration for uploading restaurant logos to Supabase Storage.
-- Run this after 202606180004_restaurant_branding_onboarding.sql.

insert into storage.buckets (id, name, public)
values ('restaurant-logos', 'restaurant-logos', true)
on conflict (id) do update
set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'restaurant_logos_select'
  ) then
    create policy restaurant_logos_select on storage.objects
      for select using (bucket_id = 'restaurant-logos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'restaurant_logos_insert'
  ) then
    create policy restaurant_logos_insert on storage.objects
      for insert with check (
        bucket_id = 'restaurant-logos'
        and (
          public.has_permission('MANAGE_SETTINGS')
          or public.has_permission('CREATE_RESTAURANT')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'restaurant_logos_update'
  ) then
    create policy restaurant_logos_update on storage.objects
      for update using (
        bucket_id = 'restaurant-logos'
        and (
          public.has_permission('MANAGE_SETTINGS')
          or public.has_permission('CREATE_RESTAURANT')
        )
      )
      with check (
        bucket_id = 'restaurant-logos'
        and (
          public.has_permission('MANAGE_SETTINGS')
          or public.has_permission('CREATE_RESTAURANT')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'restaurant_logos_delete'
  ) then
    create policy restaurant_logos_delete on storage.objects
      for delete using (
        bucket_id = 'restaurant-logos'
        and (
          public.has_permission('MANAGE_SETTINGS')
          or public.has_permission('CREATE_RESTAURANT')
        )
      );
  end if;
end $$;

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
  elsif not public.has_permission('CREATE_RESTAURANT') then
    raise exception 'Not allowed to update restaurant logo';
  end if;

  update public.restaurants
  set logo_url = nullif(p_logo_url, '')
  where id = p_restaurant_id;
end;
$$;
