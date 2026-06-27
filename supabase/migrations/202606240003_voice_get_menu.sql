-- Exposes the live menu to the external voice AI platform, mirroring bot_get_menu
-- for WhatsApp. Without this, the voice agent has no way to know this
-- restaurant's real products and can only rely on whatever prompt was typed
-- manually on the voice platform -- which is why it was mentioning items that
-- don't exist here. The agent should call this once per call (or on each
-- restart) and inject the result into its system prompt before talking to the
-- customer; voice_create_order (existing) still re-validates every item
-- against this same table when the order is finally submitted.

alter table public.restaurant_voice_settings
  add column if not exists extra_prompt text not null default '';

create or replace function public.voice_get_menu(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant record;
  result jsonb;
begin
  select r.id, r.name, r.address, r.phone, v.extra_prompt, v.notification_email
  into target_restaurant
  from public.restaurant_voice_settings v
  join public.restaurants r on r.id = v.restaurant_id
  where v.api_key = p_api_key
    and v.is_enabled = true
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

revoke all on function public.voice_get_menu(text) from public;
grant execute on function public.voice_get_menu(text) to anon, authenticated;
