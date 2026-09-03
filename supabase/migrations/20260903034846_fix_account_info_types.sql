-- ============================================================================
-- Fix: admin_get_account_info() failed with "structure of query does not
-- match function result type" — auth.users.email is character varying, not
-- text, and RETURN QUERY requires an exact column type match against the
-- function's declared RETURNS TABLE types, not just an assignable one.
-- Caught live while testing the admin-view Profile page. Cast it explicitly.
-- ============================================================================

create or replace function public.admin_get_account_info(p_user uuid)
returns table (email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  return query
    select u.email::text, u.email_confirmed_at, u.last_sign_in_at
    from auth.users u
    where u.id = p_user;
end;
$$;

grant execute on function public.admin_get_account_info(uuid) to authenticated;
