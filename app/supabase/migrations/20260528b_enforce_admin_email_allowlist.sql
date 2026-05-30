-- =====================================================================
-- Database-layer admin allowlist.
--
-- Only the allowlisted email (jwj00999@gmail.com) may hold
-- profiles.role='admin'. Any INSERT or UPDATE that sets role='admin'
-- for any other auth.users.email raises an exception, regardless of
-- which API path or RLS context attempted it.
--
-- This is belt-and-suspenders defence in depth: the application
-- layer (POST /api/admin/users/:id/role) still checks is_admin()
-- before issuing the UPDATE, but this trigger guarantees the
-- invariant at the data layer.
--
-- To change the allowlist, edit the constant inside the function.
-- =====================================================================

create or replace function public.enforce_admin_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_email text;
  allowed_email constant text := 'jwj00999@gmail.com';
begin
  -- We only need to validate when the target role is 'admin'.
  -- Non-admin role changes (e.g. demoting an admin to user) pass through.
  if NEW.role is distinct from 'admin' then
    return NEW;
  end if;

  select email into user_email
  from auth.users
  where id = NEW.id;

  if user_email is null then
    raise exception
      'Cannot promote profile % to admin: no auth user found.', NEW.id;
  end if;

  if lower(user_email) <> lower(allowed_email) then
    raise exception
      'Only the allowlisted email can hold admin role (attempted: %).',
      user_email;
  end if;

  return NEW;
end;
$$;

revoke execute on function public.enforce_admin_email_allowlist() from public;

drop trigger if exists profiles_enforce_admin_allowlist on public.profiles;
create trigger profiles_enforce_admin_allowlist
  before insert or update of role on public.profiles
  for each row
  execute function public.enforce_admin_email_allowlist();
