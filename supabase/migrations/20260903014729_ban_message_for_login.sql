-- ============================================================================
-- ban_message_for_login() — recovers a friendly ban message after a login
-- attempt fails.
-- ============================================================================
-- The hook_custom_access_token Auth Hook genuinely blocks a banned
-- account's sign-in server-side (confirmed live), but Supabase Auth turns
-- any Postgres hook exception into a generic "Error running hook..."
-- message for the client — it does not forward the exception text itself.
-- So after a failed sign-in, the client calls this (anon-callable, since
-- they're not authenticated yet) with the email/username they typed to
-- ask "was that a ban, and if so, what does it say" and shows that instead
-- of the generic error when the answer is non-null.
--
-- This can't be used to enumerate accounts: it returns null for both "no
-- such account" and "account exists but isn't banned" — the two cases a
-- wrong password already produces indistinguishably today — and only ever
-- returns non-null for a genuinely banned account, which is exactly the
-- information a banned player is supposed to see.
-- ============================================================================

create or replace function public.ban_message_for_login(p_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
stable
as $$
declare
  v_user_id uuid;
begin
  if p_identifier like '%@%' then
    select u.id into v_user_id from auth.users u where lower(u.email) = lower(p_identifier);
  else
    select p.id into v_user_id from public.profiles p where lower(p.username) = lower(p_identifier);
  end if;

  if v_user_id is null then
    return null;
  end if;

  return public.ban_message(v_user_id);
end;
$$;

grant execute on function public.ban_message_for_login(text) to anon, authenticated;
