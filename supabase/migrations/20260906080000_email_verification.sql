-- ============================================================================
-- Email verification — decoupled from Supabase Auth's own confirmation gate.
-- ============================================================================
-- Why decoupled: Supabase Auth's native "Confirm email" setting (enabled by
-- turning on auth.email.enable_confirmations) makes the ENTIRE signUp() call
-- fail — no account created at all — if sending the confirmation email
-- errors (confirmed live: 20260906 signups against this project 500'd with
-- "Error sending confirmation email" and left zero rows in auth.users).
-- That's the opposite of what's wanted here: signup must always succeed and
-- log the player in immediately, even if email delivery is flaky, with
-- verification tracked and retryable afterward rather than blocking
-- anything up front.
--
-- So auth.email.enable_confirmations stays OFF (see supabase/config.toml —
-- accounts are auto-confirmed by Supabase's own bookkeeping at signup,
-- which is why auth.users.email_confirmed_at can't be reused as "did this
-- player actually verify their real inbox" — it's always set immediately).
-- This migration adds Quest Zone's OWN verification flag instead:
--
--   1. assets/js/qz-auth.js sends a 6-digit email OTP via
--      client.auth.signInWithOtp() right after signup (best-effort — a
--      failure here does NOT fail the signup) and again on demand from the
--      "Resend" button in the email-verification modal.
--   2. The player enters that code in the modal; the client verifies it via
--      client.auth.verifyOtp({ type: 'email', ... }) — Supabase's own auth
--      server is the one that actually checks the code is correct, this
--      migration doesn't re-implement that.
--   3. Only on a SUCCESSFUL verifyOtp() does the client call
--      mark_email_verified() below, which is genuinely safe to trust:
--      a client can't fake a successful verifyOtp() response without
--      actually possessing a valid code Supabase's own server issued and
--      checked.
--
-- Every account that already exists as of this migration signed up under
-- the OLD (real Supabase confirmation) flow and is actively in use — they
-- are grandfathered in as already-verified rather than suddenly locked out
-- of their own profile.
-- ============================================================================

alter table public.profiles add column if not exists email_verified_at timestamptz;

update public.profiles set email_verified_at = created_at where email_verified_at is null;

-- ----------------------------------------------------------------------------
-- mark_email_verified() — the ONLY way this flag is ever set. Only ever
-- moves null -> now(); calling it again once already verified is a no-op,
-- not an error (idempotent, safe to call defensively from the client).
-- ----------------------------------------------------------------------------
create or replace function public.mark_email_verified()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles set email_verified_at = now()
    where id = auth.uid() and email_verified_at is null;
end;
$$;

grant execute on function public.mark_email_verified() to authenticated;
