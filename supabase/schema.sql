-- ============================================================================
-- Quest Zone — accounts, XP/leveling, inventory schema
-- ============================================================================
-- This file is kept as a full, current bootstrap reference — running it on a
-- fresh project (Project → SQL Editor → New query → paste this whole file →
-- Run) still works, and is safe to re-run: every statement is guarded with
-- IF NOT EXISTS / OR REPLACE / DROP-then-CREATE for policies.
--
-- For THIS project, schema changes as of 03/09/2026 are pushed via the
-- Supabase CLI (`supabase db push`, linked to project cbwlhrymbciihpkfjzmd)
-- instead of pasting into the SQL Editor by hand — see supabase/migrations/.
-- This file matches the migration baseline in
-- supabase/migrations/20260903004123_initial_schema.sql plus every
-- migration applied after it (currently also 20260903013123_admin_bans.sql,
-- 20260903014514_access_token_hook.sql, 20260903014729_ban_message_for_login.sql,
-- 20260903034135_admin_account_info.sql, 20260903034846_fix_account_info_types.sql,
-- 20260903040317_admin_edit_controls.sql, 20260903042739_admin_inventory_gifting.sql,
-- 20260903053242_avatar_customization.sql, and
-- 20260903062722_avatar_skin_colour_normal_default.sql).
-- Going forward, new changes land as new files under supabase/migrations/
-- AND get folded back into this file, so this stays an accurate
-- single-file snapshot too.
--
-- One manual dashboard step outside any migration: Authentication → Hooks
-- → Add hook → "Customize Access Token (JWT) Claims hook" → Postgres
-- Function → public.hook_custom_access_token, for bans to actually block a
-- login server-side (the function itself is created by
-- 20260903014514_access_token_hook.sql, but enabling it as an Auth Hook
-- isn't something a SQL migration can do). public.hook_password_verification_
-- attempt from the previous migration is unused — that hook type needs
-- Supabase's Team/Enterprise plan, not available on this project's Free plan.
--
-- After running this once on a fresh project, make YOUR OWN account an admin
-- (see the very bottom of this file for the exact command — run it AFTER
-- you've signed up through the real Quest Zone signup form).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles — one row per account, created automatically on signup
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- a fresh account starts at 0 — added as a separate ALTER so re-running
-- this file against a project that already has a profiles table (created
-- before this column existed) still picks it up
alter table public.profiles add column if not exists quest_points integer not null default 0;

-- usernames are unique, case-insensitively ("Alex" and "alex" collide)
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- ----------------------------------------------------------------------------
-- games — canonical registry of every "Total Level" game slot. New-account
-- signup seeds one game_progress row per row in here (see handle_new_user
-- below), and total_level() sums across this table rather than a hardcoded
-- count, so both automatically pick up new games the moment a row is added
-- here — no code change and no per-account backfill needed.
-- ----------------------------------------------------------------------------
create table if not exists public.games (
  game_key text primary key,
  name text not null,
  sort_order int not null
);
alter table public.games enable row level security;
drop policy if exists "games_select_all" on public.games;
create policy "games_select_all" on public.games for select using (true);

insert into public.games (game_key, name, sort_order) values
  ('space-snake', 'Space Snake', 1),
  ('total-level-2', 'Total Level Game 02', 2),
  ('total-level-3', 'Total Level Game 03', 3),
  ('total-level-4', 'Total Level Game 04', 4),
  ('total-level-5', 'Total Level Game 05', 5),
  ('total-level-6', 'Total Level Game 06', 6),
  ('total-level-7', 'Total Level Game 07', 7),
  ('total-level-8', 'Total Level Game 08', 8),
  ('total-level-9', 'Total Level Game 09', 9),
  ('total-level-10', 'Total Level Game 10', 10),
  ('total-level-11', 'Total Level Game 11', 11),
  ('total-level-12', 'Total Level Game 12', 12),
  ('total-level-13', 'Total Level Game 13', 13),
  ('total-level-14', 'Total Level Game 14', 14),
  ('total-level-15', 'Total Level Game 15', 15),
  ('total-level-16', 'Total Level Game 16', 16),
  ('total-level-17', 'Total Level Game 17', 17),
  ('total-level-18', 'Total Level Game 18', 18),
  ('total-level-19', 'Total Level Game 19', 19),
  ('total-level-20', 'Total Level Game 20', 20),
  ('total-level-21', 'Total Level Game 21', 21),
  ('total-level-22', 'Total Level Game 22', 22),
  ('total-level-23', 'Total Level Game 23', 23),
  ('total-level-24', 'Total Level Game 24', 24)
on conflict (game_key) do nothing;
-- Renaming a placeholder to a real game later: just
--   update public.games set game_key = 'real-slug', name = 'Real Name'
--   where game_key = 'total-level-N';
-- existing accounts' game_progress rows follow via the foreign key.

-- ----------------------------------------------------------------------------
-- is_admin() — SECURITY DEFINER helper so admin-read policies don't recurse
-- back into profiles' own RLS (a naive "exists (select ... from profiles
-- where is_admin)" policy on the profiles table would recheck RLS on that
-- very subquery; this function runs with the privileges of its owner and
-- bypasses RLS internally, breaking the cycle).
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and is_admin = (select is_admin from public.profiles where id = auth.uid()));
-- (the with-check re-reads the CURRENT is_admin so a normal user editing
-- their own row can never flip their own admin flag via a crafted PATCH —
-- only a direct SQL Editor UPDATE, run by you, can grant admin.)

-- profiles are inserted by the trigger below (SECURITY DEFINER), never
-- directly by clients — there is deliberately no insert policy for them.

-- ----------------------------------------------------------------------------
-- auto-create everything a fresh account needs, together, the moment
-- signup completes: the profile row (username from auth signUp(...)
-- metadata; quest_points/is_admin default to 0/false from the table
-- itself) and one game_progress row per game currently in public.games,
-- all starting at level 1 / 0 XP. inventory_items/equipped_items are
-- deliberately left with zero rows — "owns nothing, has nothing
-- equipped" IS the empty set, nothing to insert.
-- If the username is taken, this raises a friendly error and the whole
-- signup is rolled back (no orphaned auth.users row left behind).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');

  insert into public.game_progress (user_id, game_key, xp, level)
  select new.id, g.game_key, 0, 1
  from public.games g;

  return new;
exception
  when unique_violation then
    raise exception 'That username is already taken.';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- email_for_username() — lets the login form accept a username. Supabase
-- Auth itself only signs in by email, so the client looks the email up via
-- this RPC first (SECURITY DEFINER: needs to read auth.users, which anon/
-- authenticated roles can't query directly), then signs in with that email.
-- Callable by anon since you have to look this up BEFORE you're signed in.
-- ----------------------------------------------------------------------------
create or replace function public.email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.email
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(p_username)
  limit 1;
$$;

grant execute on function public.email_for_username(text) to anon, authenticated;

-- ============================================================================
-- game_progress — per-game XP + level, exact OSRS formula
-- ============================================================================
create table if not exists public.game_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null,
  xp bigint not null default 0 check (xp >= 0 and xp <= 2147483647),
  level int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_key)
);

-- game_key follows public.games(game_key): renaming a placeholder to a
-- real game's slug (see the games table above) cascades into every
-- account's existing progress row instead of orphaning it
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_progress_game_key_fkey') then
    alter table public.game_progress
      add constraint game_progress_game_key_fkey
      foreign key (game_key) references public.games(game_key)
      on update cascade on delete cascade;
  end if;
end $$;

alter table public.game_progress enable row level security;

drop policy if exists "game_progress_select_own_or_admin" on public.game_progress;
create policy "game_progress_select_own_or_admin"
  on public.game_progress for select
  using (auth.uid() = user_id or public.is_admin());

-- deliberately NO insert/update policy for clients: the only way XP ever
-- changes is through award_xp() below, so nobody can PATCH their own XP to
-- an arbitrary number via dev tools / the REST API directly.

-- ----------------------------------------------------------------------------
-- OSRS XP formula: for level L, cumulative XP required =
--   floor( (1/4) * sum_{n=1}^{L-1} floor( n + 300 * 2^(n/7) ) )
-- Verified: level 2 = 83 XP, level 99 = 13,034,431 XP. Levels keep
-- extending past 99 with the same formula (virtual levels) — there is no
-- cap on L here, only on stored xp (see award_xp).
-- ----------------------------------------------------------------------------
create or replace function public.osrs_xp_for_level(p_level int)
returns bigint
language plpgsql
immutable
as $$
declare
  total double precision := 0;
  n int;
begin
  if p_level <= 1 then
    return 0;
  end if;
  for n in 1..(p_level - 1) loop
    total := total + floor(n + 300 * power(2::double precision, n::double precision / 7));
  end loop;
  return floor(total / 4)::bigint;
end;
$$;

create or replace function public.osrs_level_for_xp(p_xp bigint)
returns int
language plpgsql
immutable
as $$
declare
  lvl int := 1;
begin
  while public.osrs_xp_for_level(lvl + 1) <= p_xp loop
    lvl := lvl + 1;
  end loop;
  return lvl;
end;
$$;

-- ----------------------------------------------------------------------------
-- total_level() — every game not yet played by p_user still counts as
-- level 1 (games's row count covers that baseline), so this is correct
-- for a brand new account (count(games) * 1) AND stays correct the
-- instant a new game is added to public.games, for every account,
-- without touching game_progress at all.
-- ----------------------------------------------------------------------------
create or replace function public.total_level(p_user uuid)
returns bigint
language sql
stable
as $$
  select (select count(*) from public.games)
       + coalesce((select sum(gp.level - 1) from public.game_progress gp where gp.user_id = p_user), 0);
$$;

grant execute on function public.total_level(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- award_xp() — the ONLY way a game's XP changes. Adds xp_to_add, caps the
-- total at 2,147,483,647 (int32 max — intentionally above OSRS's real
-- 200M cap), and recalculates level from the formula. SECURITY DEFINER so
-- it can write game_progress despite there being no client insert/update
-- policy on that table; auth.uid() inside still scopes it to the caller's
-- own row, so a player can only ever award XP to themselves.
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

grant execute on function public.award_xp(text, bigint) to authenticated;

-- ============================================================================
-- inventory — owned items + what's equipped in each slot
-- ============================================================================
create table if not exists public.inventory_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.inventory_items enable row level security;

drop policy if exists "inventory_select_own_or_admin" on public.inventory_items;
create policy "inventory_select_own_or_admin"
  on public.inventory_items for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "inventory_insert_own" on public.inventory_items;
create policy "inventory_insert_own"
  on public.inventory_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "inventory_delete_own" on public.inventory_items;
create policy "inventory_delete_own"
  on public.inventory_items for delete
  using (auth.uid() = user_id);

create table if not exists public.equipped_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,
  item_id text,
  primary key (user_id, slot)
);
alter table public.equipped_items enable row level security;

drop policy if exists "equipped_select_own_or_admin" on public.equipped_items;
create policy "equipped_select_own_or_admin"
  on public.equipped_items for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "equipped_insert_own" on public.equipped_items;
create policy "equipped_insert_own"
  on public.equipped_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "equipped_update_own" on public.equipped_items;
create policy "equipped_update_own"
  on public.equipped_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "equipped_delete_own" on public.equipped_items;
create policy "equipped_delete_own"
  on public.equipped_items for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- achievements — catalog (public reference data, like games) + per-account
-- unlocks + up to 7 pinned slots. A fresh account has zero rows in either
-- of the per-account tables, which IS "zero unlocked / none pinned" —
-- exactly like inventory_items, nothing needs seeding at signup.
-- ============================================================================
create table if not exists public.achievements (
  achievement_id text primary key,
  name text not null,
  tier text,
  description text,
  icon text,
  sort_order int
);
alter table public.achievements enable row level security;
drop policy if exists "achievements_select_all" on public.achievements;
create policy "achievements_select_all" on public.achievements for select using (true);

create table if not exists public.unlocked_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(achievement_id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.unlocked_achievements enable row level security;
drop policy if exists "unlocked_select_own_or_admin" on public.unlocked_achievements;
create policy "unlocked_select_own_or_admin"
  on public.unlocked_achievements for select
  using (auth.uid() = user_id or public.is_admin());
-- unlocking is meant to happen server-side (alongside award_xp, once a
-- real trigger condition exists) — no client insert policy yet, deliberately.

create table if not exists public.pinned_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot int not null check (slot between 1 and 7),
  achievement_id text references public.achievements(achievement_id) on delete set null,
  primary key (user_id, slot)
);
alter table public.pinned_achievements enable row level security;
-- public read, unlike unlocked_achievements/game_progress/inventory:
-- pinning IS showing off, so any signed-in-or-not visitor viewing a
-- player's profile needs to see their 7 pinned slots, not just that
-- player themselves or an admin.
drop policy if exists "pinned_select_own_or_admin" on public.pinned_achievements;
drop policy if exists "pinned_select_all" on public.pinned_achievements;
create policy "pinned_select_all" on public.pinned_achievements for select using (true);
drop policy if exists "pinned_insert_own" on public.pinned_achievements;
create policy "pinned_insert_own"
  on public.pinned_achievements for insert
  with check (auth.uid() = user_id);
drop policy if exists "pinned_update_own" on public.pinned_achievements;
create policy "pinned_update_own"
  on public.pinned_achievements for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "pinned_delete_own" on public.pinned_achievements;
create policy "pinned_delete_own"
  on public.pinned_achievements for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- Make YOUR account the admin. Run this SEPARATELY, after you have signed
-- up once through the real Quest Zone signup form, replacing the username
-- with your own:
--
--   update public.profiles set is_admin = true where username = 'YOUR_USERNAME_HERE';
--
-- Do this in the SQL Editor, not the app — it's the one write the app
-- itself is deliberately never allowed to make (see profiles_update_own
-- above), so there's no code path anywhere that can grant admin except you,
-- by hand, in the dashboard.
-- ============================================================================
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
-- ============================================================================
-- Admin Zone phase 2 — editing controls from the admin-view Profile page:
-- set a player's XP per skill, remove an inventory item, remove an
-- unlocked achievement, and auto-revoke any achievement a player no
-- longer qualifies for after their stats change. Ban/unban already exist
-- (admin_ban_user/admin_unban_user from the admin_bans migration) and are
-- just being surfaced in a new spot in the UI — nothing new needed for
-- those here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- achievements gets an optional formal requirement, so it's possible to
-- tell whether a given unlock is still earned after an admin edits XP.
-- Nullable/no-op by design: an achievement with no requirement_type (e.g.
-- a manually-granted or event achievement) is never auto-revoked — only
-- ones explicitly tied to a stat are.
-- ----------------------------------------------------------------------------
alter table public.achievements add column if not exists requirement_type text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'achievements_requirement_type_check'
  ) then
    alter table public.achievements
      add constraint achievements_requirement_type_check
      check (requirement_type is null or requirement_type in ('total_level', 'game_xp', 'game_level'));
  end if;
end $$;
alter table public.achievements add column if not exists requirement_game_key text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'achievements_requirement_game_key_fkey'
  ) then
    alter table public.achievements
      add constraint achievements_requirement_game_key_fkey
      foreign key (requirement_game_key) references public.games(game_key)
      on update cascade on delete set null;
  end if;
end $$;
alter table public.achievements add column if not exists requirement_value bigint;

-- ----------------------------------------------------------------------------
-- achievement_requirement_met() — true if p_user's CURRENT stats still
-- satisfy p_achievement_id's requirement (or the achievement has no
-- formal requirement at all, in which case it's never auto-revoked).
-- ----------------------------------------------------------------------------
create or replace function public.achievement_requirement_met(p_user uuid, p_achievement_id text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  a public.achievements%rowtype;
  v_xp bigint;
  v_level int;
begin
  select * into a from public.achievements where achievement_id = p_achievement_id;
  if a.achievement_id is null or a.requirement_type is null then
    return true;
  end if;

  if a.requirement_type = 'total_level' then
    return public.total_level(p_user) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'game_xp' then
    select xp into v_xp from public.game_progress where user_id = p_user and game_key = a.requirement_game_key;
    return coalesce(v_xp, 0) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'game_level' then
    select level into v_level from public.game_progress where user_id = p_user and game_key = a.requirement_game_key;
    return coalesce(v_level, 1) >= coalesce(a.requirement_value, 0);
  end if;
  return true;
end;
$$;
revoke execute on function public.achievement_requirement_met(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- revoke_unmet_achievements() — drops any of p_user's unlocked achievements
-- (and matching pinned slot) whose requirement their CURRENT stats no
-- longer satisfy. Internal helper, not called directly by clients — called
-- automatically at the end of admin_set_game_xp() below.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_unmet_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select ua.achievement_id
    from public.unlocked_achievements ua
    join public.achievements a on a.achievement_id = ua.achievement_id
    where ua.user_id = p_user and a.requirement_type is not null
  loop
    if not public.achievement_requirement_met(p_user, r.achievement_id) then
      delete from public.pinned_achievements where user_id = p_user and achievement_id = r.achievement_id;
      delete from public.unlocked_achievements where user_id = p_user and achievement_id = r.achievement_id;
    end if;
  end loop;
end;
$$;
revoke execute on function public.revoke_unmet_achievements(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_set_game_xp() — sets a player's XP for one game to an EXACT value
-- (not additive like award_xp — this is "customise their skills", not
-- "award more"), recalculates level from the same OSRS formula, and then
-- revokes any achievement no longer earned. SECURITY DEFINER + explicit
-- is_admin() check, same controlled-write-path pattern as every other
-- admin_* function.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_game_xp(p_user uuid, p_game_key text, p_xp bigint)
returns table (xp bigint, level int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_level int;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_xp is null or p_xp < 0 or p_xp > 2147483647 then
    raise exception 'XP must be between 0 and 2,147,483,647.';
  end if;

  insert into public.game_progress (user_id, game_key, xp, level)
  values (p_user, p_game_key, 0, 1)
  on conflict (user_id, game_key) do nothing;

  v_new_level := public.osrs_level_for_xp(p_xp);

  update public.game_progress g
    set xp = p_xp, level = v_new_level, updated_at = now()
    where g.user_id = p_user and g.game_key = p_game_key;

  perform public.revoke_unmet_achievements(p_user);

  return query
    select g.xp, g.level from public.game_progress g
    where g.user_id = p_user and g.game_key = p_game_key;
end;
$$;

grant execute on function public.admin_set_game_xp(uuid, text, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_delete_achievement() — removes one unlocked achievement (and clears
-- it from any pinned slot it's showing in) from an account.
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_achievement(p_user uuid, p_achievement_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  delete from public.pinned_achievements where user_id = p_user and achievement_id = p_achievement_id;
  delete from public.unlocked_achievements where user_id = p_user and achievement_id = p_achievement_id;
end;
$$;

grant execute on function public.admin_delete_achievement(uuid, text) to authenticated;
-- ============================================================================
-- Admin Inventory — a full-catalog "bank" only admins can see, letting them
-- grant themselves or any other player any item (including future ones,
-- automatically — it's driven by the item catalog, not a per-account list),
-- return items to it, and gift items to other players. Paired with a
-- site-wide "you received an item" notification the recipient sees the
-- next time they're not mid-game.
-- ============================================================================

alter table public.inventory_items add column if not exists granted_by uuid references auth.users(id) on delete set null;
alter table public.inventory_items add column if not exists notified_at timestamptz;

-- ----------------------------------------------------------------------------
-- username_for_id() — lets a player who was gifted an item resolve the
-- granting admin's username for the "gifted by ___" notification, without
-- being able to read that admin's whole profiles row (which own-or-admin
-- RLS would otherwise block for a non-admin looking at someone else's row).
-- Low-sensitivity by design: usernames are already effectively public
-- (shown on pinned achievements, unique at signup) — this just resolves
-- one further, same as email_for_username resolves a name to an email pre-
-- login.
-- ----------------------------------------------------------------------------
create or replace function public.username_for_id(p_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select username from public.profiles where id = p_id;
$$;

grant execute on function public.username_for_id(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- admin_grant_item() — the only way an item enters someone's inventory now.
-- Records who granted it (auth.uid()) so the recipient's "you received
-- this" popup can say who gifted it — self-grants (an admin stocking their
-- own account from the Admin Inventory) still record granted_by = the
-- admin themselves; the client only shows "gifted by ___" when that
-- differs from the recipient, so granting to yourself reads as a plain
-- pickup, not a self-congratulatory gift message.
-- ----------------------------------------------------------------------------
create or replace function public.admin_grant_item(p_recipient uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  insert into public.inventory_items (user_id, item_id, granted_by)
  values (p_recipient, p_item_id, auth.uid());

exception
  when unique_violation then
    raise exception 'This account already owns that item.';
end;
$$;

grant execute on function public.admin_grant_item(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- mark_item_seen() — lets a signed-in player mark their OWN item's "you
-- received this" popup as shown, so it doesn't show again. Deliberately a
-- narrow function rather than a general inventory_items UPDATE policy —
-- the only thing this can ever change is notified_at, and only on the
-- caller's own row.
-- ----------------------------------------------------------------------------
create or replace function public.mark_item_seen(p_item_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inventory_items
    set notified_at = now()
    where user_id = auth.uid() and item_id = p_item_id and notified_at is null;
$$;

grant execute on function public.mark_item_seen(text) to authenticated;
-- ============================================================================
-- Avatar customization — gender, hairstyle, beard, and colours for each,
-- persisted per account. Only "default"/"none" options exist as real
-- assets today (see assets/js/character-data.js) — this table exists so
-- a choice is saved and shown correctly the instant more options become
-- real, with no further schema change needed then, just new rows in the
-- client-side options list plus the matching image files.
-- ============================================================================

create table if not exists public.avatar_customization (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gender text not null default 'male',
  hair_style text not null default 'default',
  hair_colour text not null default 'default',
  beard_style text not null default 'none',
  beard_colour text not null default 'default',
  skin_colour text not null default 'default',
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'avatar_customization_gender_check'
  ) then
    alter table public.avatar_customization
      add constraint avatar_customization_gender_check check (gender in ('male', 'female'));
  end if;
end $$;

alter table public.avatar_customization enable row level security;

-- Same visibility as equipped_items/inventory_items — own account or an
-- admin (e.g. viewing it through the Admin Zone). Not public-read: there's
-- no "view any player's profile" page for the general public yet, only
-- your own and admin-view.
drop policy if exists "avatar_custom_select_own_or_admin" on public.avatar_customization;
create policy "avatar_custom_select_own_or_admin"
  on public.avatar_customization for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "avatar_custom_insert_own" on public.avatar_customization;
create policy "avatar_custom_insert_own"
  on public.avatar_customization for insert
  with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "avatar_custom_update_own" on public.avatar_customization;
create policy "avatar_custom_update_own"
  on public.avatar_customization for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not public.is_banned());

-- ----------------------------------------------------------------------------
-- Seed a default customization row the moment a fresh account is created,
-- same as profiles/game_progress — nothing to initialize manually.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');

  insert into public.game_progress (user_id, game_key, xp, level)
  select new.id, g.game_key, 0, 1
  from public.games g;

  insert into public.avatar_customization (user_id)
  values (new.id);

  return new;
exception
  when unique_violation then
    raise exception 'That username is already taken.';
end;
$$;
-- ============================================================================
-- The site's original default character (assets/img/avatar/avatar-*.png)
-- is a male skin tone called "normal" now, not a generic "default" — see
-- assets/js/character-data.js / avatar-viewer.js for why (a "default" key
-- was accidentally shared between genders and could resolve to the male
-- body under a Female label). New signups should get the correct key from
-- day one; existing rows were already backfilled by hand.
-- ============================================================================

alter table public.avatar_customization
  alter column skin_colour set default 'normal';
