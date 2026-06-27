-- Incremental migration for uploading product images to Supabase Storage.
-- Run this after 202606180006_order_creation_guardrails.sql.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update
set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'product_images_select'
  ) then
    create policy product_images_select on storage.objects
      for select using (bucket_id = 'product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'product_images_insert'
  ) then
    create policy product_images_insert on storage.objects
      for insert with check (
        bucket_id = 'product-images'
        and public.has_permission('MANAGE_PRODUCTS')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'product_images_update'
  ) then
    create policy product_images_update on storage.objects
      for update using (
        bucket_id = 'product-images'
        and public.has_permission('MANAGE_PRODUCTS')
      )
      with check (
        bucket_id = 'product-images'
        and public.has_permission('MANAGE_PRODUCTS')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'product_images_delete'
  ) then
    create policy product_images_delete on storage.objects
      for delete using (
        bucket_id = 'product-images'
        and public.has_permission('MANAGE_PRODUCTS')
      );
  end if;
end $$;
