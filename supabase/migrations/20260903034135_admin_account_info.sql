-- ============================================================================
-- admin_get_account_info() — the "Admin" read-only panel on the admin-view
-- Profile page needs email + email-verified status, neither of which is
-- exposed anywhere else (auth.users isn't directly queryable by anon/
-- authenticated, same reasoning as email_for_username). SECURITY DEFINER,
-- explicit is_admin() check — same controlled-read pattern as every other
-- admin_* function, so a non-admin calling this gets "Not authorized."
-- from Postgres itself, not just a hidden button.
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
    select u.email, u.email_confirmed_at, u.last_sign_in_at
    from auth.users u
    where u.id = p_user;
end;
$$;

grant execute on function public.admin_get_account_info(uuid) to authenticated;
