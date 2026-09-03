-- ============================================================================
-- Admin bans — permanent/temporary player bans, enforced server-side.
-- ============================================================================
-- Bans are enforced in three places, not just hidden in the admin UI:
--   1. RLS: a banned account's own write policies (equip/unequip, inventory
--      insert/delete, pinned achievements) are gated by is_banned(), and
--      award_xp() refuses to run for a banned caller — so even a lingering
--      session from before the ban can't keep progressing the account.
--   2. A Postgres "Password Verification" Auth Hook (registered separately,
--      by hand, in Supabase Dashboard → Authentication → Hooks — same kind
--      of one-off dashboard step as Confirm Email / SMTP) rejects the sign-
--      in attempt itself for a banned account, with the ban reason/duration
--      as the error message. This runs inside Supabase Auth, before a
--      session is ever issued — it can't be bypassed by calling the API
--      directly instead of going through the app's login form.
--   3. The app itself (qz-auth.js) also checks ban status right after a
--      successful sign-in and after loading any page's session, and signs
--      the account out immediately if banned — so an already-open tab gets
--      kicked out promptly instead of waiting for its token to expire.
-- ============================================================================

alter table public.profiles add column if not exists banned_permanently boolean not null default false;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_by uuid references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- is_banned(p_user) — true if permanently banned, or temp-banned with
-- banned_until still in the future. Defaults to the CALLER (auth.uid()), so
-- RLS policies can write "and not public.is_banned()" with no argument.
-- SECURITY DEFINER for the same reason as is_admin(): a naive policy that
-- subqueries profiles directly would recheck RLS on itself.
-- ----------------------------------------------------------------------------
create or replace function public.is_banned(p_user uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select banned_permanently or (banned_until is not null and banned_until > now())
     from public.profiles where id = p_user),
    false
  );
$$;

grant execute on function public.is_banned(uuid) to authenticated, anon;

-- Human-readable ban message, reused by the login hook below and available
-- to the client for displaying "why was I banned" without re-deriving it.
create or replace function public.ban_message(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or not public.is_banned(p_user) then
    return null;
  end if;
  if p.banned_permanently then
    return 'This account has been permanently banned.'
      || case when p.ban_reason is not null and p.ban_reason <> '' then ' Reason: ' || p.ban_reason else '' end;
  end if;
  return 'This account is banned until ' || to_char(p.banned_until at time zone 'utc', 'HH12:MI AM "on" DD/MM/YYYY') || ' (UTC).'
    || case when p.ban_reason is not null and p.ban_reason <> '' then ' Reason: ' || p.ban_reason else '' end;
end;
$$;

grant execute on function public.ban_message(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- profiles_update_own — extend the existing self-update guard so a banned
-- user can never lift their own ban via a crafted PATCH either, the same
-- way it already stops a normal user from setting their own is_admin.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
    and banned_permanently = (select banned_permanently from public.profiles where id = auth.uid())
    and banned_until is not distinct from (select banned_until from public.profiles where id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- admin_ban_user() / admin_unban_user() — the ONLY way ban fields change.
-- SECURITY DEFINER + explicit is_admin() check, same controlled-write-path
-- pattern as award_xp(): there is no RLS "admins can update anyone" policy
-- at all, only these two narrow, audited entry points.
-- p_hours: null + p_permanent=false means "unban" is done via
-- admin_unban_user instead; p_hours is required for a temporary ban.
-- ----------------------------------------------------------------------------
create or replace function public.admin_ban_user(p_user uuid, p_hours numeric, p_permanent boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot ban your own account.';
  end if;
  if not coalesce(p_permanent, false) and (p_hours is null or p_hours <= 0) then
    raise exception 'A temporary ban needs a duration.';
  end if;

  update public.profiles
    set banned_permanently = coalesce(p_permanent, false),
        banned_until = case when coalesce(p_permanent, false) then null
                             else now() + (p_hours || ' hours')::interval end,
        ban_reason = nullif(trim(coalesce(p_reason, '')), ''),
        banned_at = now(),
        banned_by = auth.uid()
    where id = p_user;

  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

grant execute on function public.admin_ban_user(uuid, numeric, boolean, text) to authenticated;

create or replace function public.admin_unban_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  update public.profiles
    set banned_permanently = false, banned_until = null, ban_reason = null
    where id = p_user;
  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

grant execute on function public.admin_unban_user(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_delete_inventory_item() — lets an admin remove an owned item from
-- any account (e.g. an exploited/duped item), also clearing it from
-- equipped_items so nothing is left equipped-but-not-owned. Same controlled-
-- function pattern as the ban functions above, rather than a broad RLS
-- "admins can delete anyone's inventory rows" policy.
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_inventory_item(p_user uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  delete from public.equipped_items where user_id = p_user and item_id = p_item_id;
  delete from public.inventory_items where user_id = p_user and item_id = p_item_id;
end;
$$;

grant execute on function public.admin_delete_inventory_item(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Defense in depth: a banned account can't keep acting on its own data even
-- if it still holds a live session from before the ban.
-- ----------------------------------------------------------------------------
create or replace function public.award_xp(p_game_key text, p_xp_to_add bigint)
returns table (xp bigint, level int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new_xp bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;
  if p_xp_to_add is null or p_xp_to_add < 0 then
    raise exception 'xp_to_add must be a non-negative integer';
  end if;

  insert into public.game_progress (user_id, game_key, xp, level)
  values (v_uid, p_game_key, 0, 1)
  on conflict (user_id, game_key) do nothing;

  update public.game_progress g
    set xp = least(2147483647, g.xp + p_xp_to_add),
        updated_at = now()
    where g.user_id = v_uid and g.game_key = p_game_key
    returning g.xp into v_new_xp;

  update public.game_progress g
    set level = public.osrs_level_for_xp(v_new_xp)
    where g.user_id = v_uid and g.game_key = p_game_key;

  return query
    select g.xp, g.level
    from public.game_progress g
    where g.user_id = v_uid and g.game_key = p_game_key;
end;
$$;

drop policy if exists "inventory_insert_own" on public.inventory_items;
create policy "inventory_insert_own"
  on public.inventory_items for insert
  with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "inventory_delete_own" on public.inventory_items;
create policy "inventory_delete_own"
  on public.inventory_items for delete
  using (auth.uid() = user_id and not public.is_banned());

drop policy if exists "equipped_insert_own" on public.equipped_items;
create policy "equipped_insert_own"
  on public.equipped_items for insert
  with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "equipped_update_own" on public.equipped_items;
create policy "equipped_update_own"
  on public.equipped_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "equipped_delete_own" on public.equipped_items;
create policy "equipped_delete_own"
  on public.equipped_items for delete
  using (auth.uid() = user_id and not public.is_banned());

drop policy if exists "pinned_insert_own" on public.pinned_achievements;
create policy "pinned_insert_own"
  on public.pinned_achievements for insert
  with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "pinned_update_own" on public.pinned_achievements;
create policy "pinned_update_own"
  on public.pinned_achievements for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not public.is_banned());

-- ----------------------------------------------------------------------------
-- Postgres Auth Hook — "Password Verification Hook". This function must be
-- turned on by hand in Supabase Dashboard → Authentication → Hooks (BETA),
-- selecting public.hook_password_verification_attempt as a Postgres Hook —
-- the CLI/migrations can create the function but can't flip that Auth
-- service setting, the same way SMTP/Confirm Email needed a dashboard step.
-- Once enabled, Supabase Auth calls this after checking the password but
-- before issuing a session, so a banned account is rejected before ever
-- getting a token — not just hidden by the app afterwards.
-- ----------------------------------------------------------------------------
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (event->>'user_id')::uuid;
begin
  if v_user_id is not null and public.is_banned(v_user_id) then
    return jsonb_build_object(
      'decision', 'reject',
      'message', coalesce(public.ban_message(v_user_id), 'This account is banned.')
    );
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_password_verification_attempt(jsonb) from authenticated, anon, public;
