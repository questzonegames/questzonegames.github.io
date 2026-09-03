-- ============================================================================
-- Custom Access Token Hook — the actual server-side ban enforcement.
-- ============================================================================
-- The "Password Verification Attempt" hook (used by
-- hook_password_verification_attempt, added in the previous migration) turns
-- out to require Supabase's Team/Enterprise plan — not available on this
-- project's Free plan. That function is left in place (harmless, unused)
-- for if the project ever upgrades.
--
-- The "Customize Access Token (JWT) Claims" hook IS available on Free plan,
-- and works even better for banning here: it runs on every token issuance
-- AND every token refresh, not just the initial sign-in. Raising an
-- exception in it fails the whole operation — so a banned account can't
-- get a new access token at sign-in, and an account banned mid-session
-- fails to refresh its session the next time GoTrue tries to (typically
-- within the hour, per [auth] token expiry in supabase/config.toml),
-- server-side, with no reliance on the client behaving.
--
-- Manual dashboard step (same category as SMTP/Confirm Email/the abandoned
-- Password Verification hook): Authentication → Hooks → Add hook →
-- "Customize Access Token (JWT) Claims hook" → Postgres Function →
-- public.hook_custom_access_token.
-- ============================================================================

create or replace function public.hook_custom_access_token(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (event->>'user_id')::uuid;
begin
  if v_user_id is not null and public.is_banned(v_user_id) then
    raise exception '%', coalesce(public.ban_message(v_user_id), 'This account is banned.');
  end if;
  return jsonb_build_object('claims', event->'claims');
end;
$$;

grant execute on function public.hook_custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_custom_access_token(jsonb) from authenticated, anon, public;
