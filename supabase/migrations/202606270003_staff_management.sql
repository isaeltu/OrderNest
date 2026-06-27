-- Lets an admin change a staff member's role from the new "Manage Access"
-- screen. There was previously no UPDATE policy or function for profiles at
-- all (only the initial select policy), so role changes had to be done by
-- hand in the Supabase dashboard.

create or replace function public.update_staff_role(
  p_profile_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_role_id uuid;
begin
  if not public.has_permission('MANAGE_USERS') then
    raise exception 'Not allowed to manage staff';
  end if;

  target_restaurant_id := public.current_restaurant_id();

  select id into target_role_id from public.roles where name = p_role;
  if target_role_id is null then
    raise exception 'Rol invalido: %', p_role;
  end if;

  update public.profiles
  set role_id = target_role_id
  where id = p_profile_id and restaurant_id = target_restaurant_id;

  if not found then
    raise exception 'No se encontro el usuario en este restaurante.';
  end if;
end;
$$;

-- Lets any signed-in user update their own display name from "My Profile".
-- Scoped to auth.uid() only, and only touches full_name -- email/password
-- changes go through supabase.auth.updateUser() on the client instead,
-- since those live in auth.users, not public.profiles.
create or replace function public.update_my_profile(
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_full_name is null or trim(p_full_name) = '' then
    raise exception 'El nombre no puede estar vacio.';
  end if;

  update public.profiles
  set full_name = p_full_name
  where id = auth.uid();
end;
$$;
