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
-- 20260903053242_avatar_customization.sql,
-- 20260903062722_avatar_skin_colour_normal_default.sql,
-- 20260905010000_anagram_quest.sql,
-- 20260905020000_intelligence_skill.sql,
-- 20260905030000_only_intelligence_skill.sql,
-- 20260905040000_security_hardening.sql,
-- 20260905050000_public_highscores.sql,
-- 20260905050100_fix_hiscores_null_level_bug.sql,
-- 20260905050200_fix_hiscores_xp_type.sql,
-- 20260905060000_hide_test_accounts_from_highscores.sql,
-- 20260906010000_avatar_rig_editor.sql,
-- 20260906020000_anagram_quest_difficulty_stats.sql,
-- 20260906030000_fix_anagram_quest_stats_ambiguous_column.sql,
-- 20260906050000_admin_hide_and_delete_accounts.sql,
-- 20260906060000_players_search_and_public_profiles.sql,
-- 20260906070000_players_search_avatar_thumbnails.sql, and
-- 20260906080000_email_verification.sql).
-- As of 06/09/2026 this list was cross-checked against `supabase migration
-- list` (every local migration file's timestamp matches an applied remote
-- migration, zero drift) and every function/table below was folded in from
-- the actual migration file content, not retyped from memory.
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

-- Intelligence is, for now, the only real, coded skill — every other slot
-- (Space Snake included) was removed by
-- supabase/migrations/20260905030000_only_intelligence_skill.sql. Add a new
-- row here the moment another skill is ready to go live.
insert into public.games (game_key, name, sort_order) values
  ('intelligence', 'Intelligence', 1)
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

-- ----------------------------------------------------------------------------
-- game_stats — high score + games played, per (user, game). Generic across
-- games on purpose (same shape as game_progress's xp/level) so the next
-- game that needs a persisted high score/play count reuses this table
-- instead of getting its own bespoke one. First user: Anagram Quest.
-- ----------------------------------------------------------------------------
create table if not exists public.game_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null references public.games(game_key) on update cascade on delete cascade,
  high_score int not null default 0,
  games_played int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_key)
);
alter table public.game_stats enable row level security;

drop policy if exists "game_stats_select_own_or_admin" on public.game_stats;
create policy "game_stats_select_own_or_admin"
  on public.game_stats for select
  using (auth.uid() = user_id or public.is_admin());

-- deliberately no insert/update policy for clients — same reasoning as
-- game_progress: the only way these change is record_game_result() below,
-- so nobody can PATCH their own high score via the REST API directly.

-- ----------------------------------------------------------------------------
-- record_game_result() — the ONLY way game_stats changes. Called once per
-- completed game (not per round). Always increments games_played by 1;
-- raises high_score only if the new score beats it. p_score is clamped to
-- a sane range so a tampered client can't write an absurd value straight
-- into the leaderboard/high-score column — a coarse backstop, not full
-- server-side replay validation, but matches every other write path in
-- this schema: no raw client UPDATE reaches the table at all.
-- ----------------------------------------------------------------------------
create or replace function public.record_game_result(p_game_key text, p_score int)
returns table (high_score int, games_played int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score int := greatest(0, least(coalesce(p_score, 0), 100000));
begin
  insert into public.game_stats (user_id, game_key, high_score, games_played)
  values (auth.uid(), p_game_key, v_score, 1)
  on conflict (user_id, game_key) do update
    set high_score = greatest(public.game_stats.high_score, excluded.high_score),
        games_played = public.game_stats.games_played + 1,
        updated_at = now();

  return query
    select gs.high_score, gs.games_played
    from public.game_stats gs
    where gs.user_id = auth.uid() and gs.game_key = p_game_key;
end;
$$;

grant execute on function public.record_game_result(text, int) to authenticated;

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
-- ============================================================================
-- Security hardening pass (20260905040000_security_hardening.sql) — see
-- SECURITY.md for the permanent rules. Summary of what changed here:
--   1. award_xp() now rejects any single call above 2,000,000 XP — it had
--      no upper bound at all before, so any authenticated caller could
--      award themselves an arbitrary amount directly via the REST API.
--   2. total_level() now caps each skill's contribution at level 99 —
--      virtual levels (past 99) are a display-only concept and must not
--      inflate Total Level, matching real OSRS semantics.
--   3. osrs_xp_for_level/osrs_level_for_xp now pin search_path (matches
--      every other function in this file; flagged by `supabase db
--      advisors` as the only 3 that didn't).
--   4. osrs_xp_for_level/osrs_level_for_xp/handle_new_user had EXECUTE
--      revoked from public/anon/authenticated — Postgres grants EXECUTE
--      to PUBLIC by default unless revoked, so these were reachable via
--      /rest/v1/rpc/<name> despite being internal-only helpers/a
--      trigger function never meant to be called directly. No client
--      code called any of them directly (verified).
--   5. profiles.username now has a real format CHECK constraint at the
--      database layer (matching qz-auth.js's existing client-side
--      regex), closing the gap where calling supabase.auth.signUp()
--      directly (bypassing QZAuth.signUp()) skipped that validation
--      entirely. Verified safe against every existing account first.
-- ============================================================================

create or replace function public.award_xp(p_game_key text, p_xp_to_add bigint)
returns table (xp bigint, level int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new_xp bigint;
  v_max_xp_per_call constant bigint := 2000000;
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
  if p_xp_to_add > v_max_xp_per_call then
    raise exception 'xp_to_add exceeds the maximum allowed for a single award (%).', v_max_xp_per_call;
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

create or replace function public.total_level(p_user uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select (select count(*) from public.games)
       + coalesce((select sum(least(gp.level, 99) - 1) from public.game_progress gp where gp.user_id = p_user), 0);
$$;

grant execute on function public.total_level(uuid) to authenticated, anon;

create or replace function public.osrs_xp_for_level(p_level int)
returns bigint
language plpgsql
immutable
set search_path = public
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
set search_path = public
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

revoke execute on function public.osrs_xp_for_level(int) from public, anon, authenticated;
revoke execute on function public.osrs_level_for_xp(bigint) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username ~ '^[A-Za-z0-9_]{3,20}$');
  end if;
end $$;

-- ============================================================================
-- Public Highscores — read-only leaderboard RPCs (folded together from
-- 20260905050000/050100/050200/060000 as their final, correct shape). See
-- SECURITY.md and the migrations themselves for the full reasoning; short
-- version: SECURITY DEFINER so they can rank across every account despite
-- profiles/game_progress RLS being locked to "your own row or an admin",
-- but each one returns only public columns (username, level, xp, rank) —
-- never email, ban details, or any other private field. None of them
-- write anything; highscores can never change XP.
--
-- Claude-created test accounts (is_test_account, see below) are excluded
-- from all three unless the CALLER is an admin — anonymous visitors and
-- ordinary signed-in players never see them; an admin (e.g. James) does.
-- ============================================================================

alter table public.profiles add column if not exists is_test_account boolean not null default false;

-- admin_set_test_account() — the only way is_test_account changes. Same
-- controlled-write-path pattern as every other admin_* function.
create or replace function public.admin_set_test_account(p_user uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  update public.profiles set is_test_account = coalesce(p_is_test, false) where id = p_user;
  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

grant execute on function public.admin_set_test_account(uuid, boolean) to authenticated;

-- Mark the current, known Claude-created test accounts (created across
-- earlier sessions while testing signup/ban/XP flows) — a fresh install
-- of this file has no such accounts to mark; this is a no-op then.
update public.profiles
   set is_test_account = true
 where lower(username) in (
   'qz_testplayer1', 'qz_freshtest2', 'qz_confirmtest3', 'qz_resendtest1', 'qz_bantest1'
 );

-- ============================================================================
-- Admin: Hide Account + Delete Account (see
-- supabase/migrations/20260906050000_admin_hide_and_delete_accounts.sql).
--
-- The four account states an admin can put an account into:
--   - Active             — normal, shows everywhere.
--   - Temp-banned        — still shows on Highscores/Players (with
--                          is_banned = true so the client renders a
--                          "BANNED"/"Temporarily Banned" tag), can't log in
--                          until banned_until passes. Username stays
--                          reserved (the row still exists).
--   - Permanently banned — excluded from Highscores/Players entirely, can
--                          never log in again unless unbanned. The row
--                          (and its username) still exists, so nobody else
--                          can ever register that username while banned.
--   - Hidden             — fully reversible, cosmetic-only: doesn't show on
--                          Highscores/Players, but the account works
--                          completely normally otherwise. Distinct from a
--                          ban: no login block, no is_banned() involvement.
--   - Deleted (not a flag — the row is gone) — every table cascades from
--                          auth.users(id) on delete cascade, so deleting
--                          the auth.users row removes everything and frees
--                          the username for reuse from scratch.
-- ============================================================================

alter table public.profiles add column if not exists is_hidden boolean not null default false;

create or replace function public.admin_hide_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  update public.profiles set is_hidden = true where id = p_user;
  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

grant execute on function public.admin_hide_user(uuid) to authenticated;

create or replace function public.admin_unhide_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  update public.profiles set is_hidden = false where id = p_user;
  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

grant execute on function public.admin_unhide_user(uuid) to authenticated;

-- Permanently deletes an account and every trace of its data, freeing its
-- username for reuse. SECURITY DEFINER so it can reach into auth.users (a
-- normal authenticated role has no privileges there) — deletes auth.users
-- directly (not just public.profiles) since every user-owned table
-- references auth.users(id) on delete cascade. There is no undo — the
-- confirmation lives entirely in the admin UI (profile/admin.html).
create or replace function public.admin_delete_account(p_user uuid)
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
    raise exception 'You cannot delete your own account.';
  end if;

  delete from auth.users where id = p_user;

  if not found then
    raise exception 'No such account.';
  end if;
end;
$$;

grant execute on function public.admin_delete_account(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Highscores — final, current versions (superseding the pre-is_banned/
-- pre-is_hidden versions from 20260905050000/20260905060000): a temp ban no
-- longer hides an account from Highscores/Players (it shows with
-- is_banned = true instead), but a permanent ban and a hidden account both
-- stay excluded entirely.
-- ----------------------------------------------------------------------------
create or replace function public.hiscores_overall(p_limit int default 25, p_offset int default 0)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  total_level bigint,
  total_xp bigint,
  is_banned boolean,
  total_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with totals as (
    select
      p.id as user_id,
      p.username,
      (select count(*) from public.games)
        + coalesce(sum(least(gp.level, 99) - 1) filter (where gp.user_id is not null), 0) as total_level,
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0)::bigint as total_xp,
      (p.banned_until is not null and p.banned_until > now()) as is_banned
    from public.profiles p
    left join public.game_progress gp on gp.user_id = p.id
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
    group by p.id, p.username, p.banned_until
  )
  select
    row_number() over (order by total_level desc, total_xp desc, username asc) as rank,
    user_id, username, total_level, total_xp, is_banned,
    count(*) over () as total_count
  from totals
  order by total_level desc, total_xp desc, username asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.hiscores_overall(int, int) to anon, authenticated;

-- Single-skill leaderboard. Only accounts with an actual game_progress row
-- for this skill appear (real OSRS "unranked until trained" behaviour) —
-- unlike Overall, a never-played account isn't shown cluttering the list.
create or replace function public.hiscores_skill(p_game_key text, p_limit int default 25, p_offset int default 0)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  level int,
  xp bigint,
  is_banned boolean,
  total_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with rows as (
    select p.id as user_id, p.username, gp.level, gp.xp,
      (p.banned_until is not null and p.banned_until > now()) as is_banned
    from public.game_progress gp
    join public.profiles p on p.id = gp.user_id
    where gp.game_key = p_game_key
      and not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
  )
  select
    row_number() over (order by level desc, xp desc, username asc) as rank,
    user_id, username, level, xp, is_banned,
    count(*) over () as total_count
  from rows
  order by level desc, xp desc, username asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.hiscores_skill(text, int, int) to anon, authenticated;

-- Powers Search and Compare, and (via the client calling it directly)
-- Players' public skill view: case-insensitive exact username match, zero
-- rows for "no such account", "permanently banned", "hidden", AND "test
-- account and caller isn't an admin" alike — none distinguishable from each
-- other to a non-admin caller. `skills` is a jsonb map of every real
-- game_key -> {level, xp, rank} (rank null = never played that skill) so
-- adding a new skill to public.games later needs no change here.
create or replace function public.hiscores_player_stats(p_username text)
returns table (
  user_id uuid,
  username text,
  total_level bigint,
  total_xp bigint,
  overall_rank bigint,
  is_banned boolean,
  skills jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid;
  v_caller_is_admin boolean := public.is_admin();
  v_is_banned boolean;
begin
  select p.id, (p.banned_until is not null and p.banned_until > now())
    into v_user_id, v_is_banned
  from public.profiles p
  where lower(p.username) = lower(p_username)
    and not p.banned_permanently
    and not p.is_hidden
    and (not p.is_test_account or v_caller_is_admin);

  if v_user_id is null then
    return; -- empty result set = "not found" to the caller
  end if;

  return query
  with totals as (
    select
      p.id as uid,
      p.username as uname,
      (select count(*) from public.games)
        + coalesce(sum(least(gp.level, 99) - 1) filter (where gp.user_id is not null), 0) as tlevel,
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0)::bigint as txp
    from public.profiles p
    left join public.game_progress gp on gp.user_id = p.id
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or v_caller_is_admin)
    group by p.id, p.username
  ),
  ranked as (
    select uid, uname, tlevel, txp,
      row_number() over (order by tlevel desc, txp desc, uname asc) as rnk
    from totals
  ),
  skill_ranks as (
    select gp.user_id, gp.game_key, gp.level, gp.xp,
      row_number() over (partition by gp.game_key order by gp.level desc, gp.xp desc, pr.username asc) as srank
    from public.game_progress gp
    join public.profiles pr on pr.id = gp.user_id
    where not pr.banned_permanently
      and not pr.is_hidden
      and (not pr.is_test_account or v_caller_is_admin)
  ),
  skillmap as (
    select jsonb_object_agg(
      g.game_key,
      jsonb_build_object('level', coalesce(sr.level, 1), 'xp', coalesce(sr.xp, 0), 'rank', sr.srank)
    ) as skills
    from public.games g
    left join skill_ranks sr on sr.game_key = g.game_key and sr.user_id = v_user_id
  )
  select r.uid, r.uname, r.tlevel, r.txp, r.rnk, v_is_banned, sm.skills
  from ranked r, skillmap sm
  where r.uid = v_user_id;
end;
$$;

grant execute on function public.hiscores_player_stats(text) to anon, authenticated;

-- ============================================================================
-- Avatar Rig Editor — canonical, admin-editable avatar calibration data
-- (see supabase/migrations/20260906010000_avatar_rig_editor.sql).
--
-- This is the ONE place item placement (Admin Crown today, any future
-- head/necklace/body/legs/boots/gloves/back/mainHand/offHand/accessory item
-- tomorrow) and the base rig anchors (SKULL/ABOVE_HEAD/FOREHEAD/NECK per
-- direction) live. assets/js/avatar-viewer.js (the REAL renderer every
-- player sees) reads these same rows -- the admin editor and the live game
-- are one reader (the editor UI) and one writer (the admin RPCs below) of
-- the same tables, never two systems that can drift.
--
-- Security model: RLS SELECT is public (`using (true)`) on both tables --
-- every visitor's browser needs to read this to render ANY player wearing
-- the item correctly, not just admins (this data was already effectively
-- public, baked into PNG pixels/CSS before this). There is NO insert/
-- update/delete RLS policy on either table -- the only way to change a row
-- is through a SECURITY DEFINER RPC that re-checks is_admin() itself.
-- ============================================================================

create table if not exists public.avatar_rig_anchors (
  body_type text not null default 'male',
  direction text not null check (direction in ('front','right','back','left')),
  anchor_type text not null check (anchor_type in ('above_head','skull','forehead','neck')),
  canvas_w int not null check (canvas_w > 0),
  canvas_h int not null check (canvas_h > 0),
  center_x_pct numeric not null check (center_x_pct between 0 and 100),
  y_pct numeric not null check (y_pct between -20 and 120),
  width_pct numeric not null check (width_pct between 0 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (body_type, direction, anchor_type)
);
alter table public.avatar_rig_anchors enable row level security;

drop policy if exists "avatar_rig_anchors_select_public" on public.avatar_rig_anchors;
create policy "avatar_rig_anchors_select_public"
  on public.avatar_rig_anchors for select
  using (true);
-- deliberately no insert/update/delete policy -- see header comment.

create table if not exists public.avatar_rig_items (
  body_type text not null default 'male',
  slot text not null check (slot in ('head','necklace','body','legs','boots','gloves','back','mainHand','offHand','accessory')),
  item_id text not null,
  direction text not null check (direction in ('front','right','back','left')),
  anchor_type text not null check (anchor_type in ('above_head','skull','forehead','neck')),
  offset_x numeric not null default 0 check (offset_x between -2000 and 2000),
  offset_y numeric not null default 0 check (offset_y between -2000 and 2000),
  scale numeric not null default 1 check (scale between 0.05 and 5),
  rotation numeric not null default 0 check (rotation between -180 and 180),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (body_type, slot, item_id, direction)
);
alter table public.avatar_rig_items enable row level security;

drop policy if exists "avatar_rig_items_select_public" on public.avatar_rig_items;
create policy "avatar_rig_items_select_public"
  on public.avatar_rig_items for select
  using (true);
-- deliberately no insert/update/delete policy -- see header comment.

create table if not exists public.avatar_rig_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  body_type text,
  slot text,
  item_id text,
  direction text,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.avatar_rig_audit_log enable row level security;

drop policy if exists "avatar_rig_audit_log_select_admin" on public.avatar_rig_audit_log;
create policy "avatar_rig_audit_log_select_admin"
  on public.avatar_rig_audit_log for select
  using (public.is_admin());
-- no insert/update/delete policy -- RPC-only, see header comment.

-- admin_save_avatar_rig_item() -- the ONLY way an item's calibration
-- changes. Upserts one (body_type, slot, item_id, direction) row.
create or replace function public.admin_save_avatar_rig_item(
  p_body_type text, p_slot text, p_item_id text, p_direction text,
  p_anchor_type text, p_offset_x numeric, p_offset_y numeric,
  p_scale numeric, p_rotation numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_item_id is null or length(trim(p_item_id)) = 0 then
    raise exception 'Missing item id.';
  end if;

  insert into public.avatar_rig_items
    (body_type, slot, item_id, direction, anchor_type, offset_x, offset_y, scale, rotation, updated_at, updated_by)
  values
    (coalesce(p_body_type, 'male'), p_slot, p_item_id, p_direction, p_anchor_type, p_offset_x, p_offset_y, p_scale, p_rotation, now(), auth.uid())
  on conflict (body_type, slot, item_id, direction) do update set
    anchor_type = excluded.anchor_type,
    offset_x = excluded.offset_x,
    offset_y = excluded.offset_y,
    scale = excluded.scale,
    rotation = excluded.rotation,
    updated_at = now(),
    updated_by = auth.uid();

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, slot, item_id, direction, detail)
  values (auth.uid(), 'save_item', p_body_type, p_slot, p_item_id, p_direction,
    jsonb_build_object('anchorType', p_anchor_type, 'offsetX', p_offset_x, 'offsetY', p_offset_y, 'scale', p_scale, 'rotation', p_rotation));
end;
$$;

grant execute on function public.admin_save_avatar_rig_item(text, text, text, text, text, numeric, numeric, numeric, numeric) to authenticated;

-- admin_reset_avatar_rig_item_to_factory() -- deletes the calibration
-- row(s) for an item, so it falls back to the built-in JS default
-- transform. p_direction = null resets all 4 directions at once.
create or replace function public.admin_reset_avatar_rig_item_to_factory(
  p_body_type text, p_slot text, p_item_id text, p_direction text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  delete from public.avatar_rig_items
    where body_type = coalesce(p_body_type, 'male')
      and slot = p_slot
      and item_id = p_item_id
      and (p_direction is null or direction = p_direction);

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, slot, item_id, direction)
  values (auth.uid(), 'reset_item_to_factory', p_body_type, p_slot, p_item_id, p_direction);
end;
$$;

grant execute on function public.admin_reset_avatar_rig_item_to_factory(text, text, text, text) to authenticated;

-- admin_save_avatar_rig_anchor() -- RIG ANCHOR mode: changes the underlying
-- body anchor itself (affects every item using that anchor type).
create or replace function public.admin_save_avatar_rig_anchor(
  p_body_type text, p_direction text, p_anchor_type text,
  p_center_x_pct numeric, p_y_pct numeric, p_width_pct numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  insert into public.avatar_rig_anchors
    (body_type, direction, anchor_type, canvas_w, canvas_h, center_x_pct, y_pct, width_pct, updated_at, updated_by)
  select
    coalesce(p_body_type, 'male'), p_direction, p_anchor_type,
    canvas_w, canvas_h, p_center_x_pct, p_y_pct, p_width_pct, now(), auth.uid()
  from public.avatar_rig_anchors
  where body_type = coalesce(p_body_type, 'male') and direction = p_direction and anchor_type = p_anchor_type
  on conflict (body_type, direction, anchor_type) do update set
    center_x_pct = excluded.center_x_pct,
    y_pct = excluded.y_pct,
    width_pct = excluded.width_pct,
    updated_at = now(),
    updated_by = auth.uid();

  if not found then
    raise exception 'Unknown anchor row -- canvas_w/canvas_h must already exist for this body/direction/anchor.';
  end if;

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, direction, detail)
  values (auth.uid(), 'save_anchor', p_body_type, p_direction,
    jsonb_build_object('anchorType', p_anchor_type, 'centerXPct', p_center_x_pct, 'yPct', p_y_pct, 'widthPct', p_width_pct));
end;
$$;

grant execute on function public.admin_save_avatar_rig_anchor(text, text, text, numeric, numeric, numeric) to authenticated;

-- Seed data -- the male body's 4 anchors x 4 directions, taken verbatim
-- from assets/js/avatar-rig.js's HEAD_ANCHORS (measured off the bald
-- base's own alpha channel), plus the Admin Crown's already-visually-
-- verified calibration -- a fresh install renders identically to the live
-- site.
insert into public.avatar_rig_anchors (body_type, direction, anchor_type, canvas_w, canvas_h, center_x_pct, y_pct, width_pct) values
  ('male','front','above_head', 636,1514, 50.31, 0.66,  25.47),
  ('male','front','skull',      636,1514, 50.31, 6.66,  25.47),
  ('male','front','forehead',   636,1514, 50.31, 9.58,  32.23),
  ('male','front','neck',       636,1514, 50.31, 14.86, 17.61),
  ('male','back', 'above_head', 584,1514, 49.49, 0.66,  28.42),
  ('male','back', 'skull',      584,1514, 49.49, 6.66,  28.42),
  ('male','back', 'forehead',   584,1514, 49.49, 9.71,  34.25),
  ('male','back', 'neck',       584,1514, 49.49, 14.86, 18.49),
  ('male','right','above_head', 302,1515, 54.64, 0.66,  66.89),
  ('male','right','skull',      302,1515, 54.64, 7.26,  66.89),
  ('male','right','forehead',   302,1515, 54.64, 9.90,  66.89),
  ('male','right','neck',       302,1515, 54.64, 15.84, 53.64),
  ('male','left', 'above_head', 302,1515, 45.03, 0.66,  66.89),
  ('male','left', 'skull',      302,1515, 45.03, 7.26,  66.89),
  ('male','left', 'forehead',   302,1515, 45.03, 9.90,  66.89),
  ('male','left', 'neck',       302,1515, 45.03, 15.84, 53.64)
on conflict (body_type, direction, anchor_type) do nothing;

insert into public.avatar_rig_items (body_type, slot, item_id, direction, anchor_type, offset_x, offset_y, scale, rotation) values
  ('male','head','admin-crown','front', 'skull', 0,    11.2, 0.833, 0),
  ('male','head','admin-crown','back',  'skull', 0,    13.2, 0.831, 0),
  ('male','head','admin-crown','right', 'skull', 0,   -2.0,  0.619, 0),
  ('male','head','admin-crown','left',  'skull', 0,   -2.0,  0.619, 0)
on conflict (body_type, slot, item_id, direction) do nothing;

-- ============================================================================
-- Anagram Quest -- per-difficulty high scores + 9-letter-word counters (see
-- supabase/migrations/20260906020000_anagram_quest_difficulty_stats.sql,
-- corrected by 20260906030000_fix_anagram_quest_stats_ambiguous_column.sql
-- -- the function below is already that corrected version).
-- ============================================================================

create table if not exists public.anagram_quest_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  easy_high_score int not null default 0,
  medium_high_score int not null default 0,
  hard_high_score int not null default 0,
  easy_nine_count int not null default 0,
  medium_nine_count int not null default 0,
  hard_nine_count int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.anagram_quest_stats enable row level security;

-- Personal stats, not a leaderboard -- own row or admin only.
drop policy if exists "anagram_quest_stats_select_own_or_admin" on public.anagram_quest_stats;
create policy "anagram_quest_stats_select_own_or_admin"
  on public.anagram_quest_stats for select
  using (auth.uid() = user_id or public.is_admin());
-- Deliberately no insert/update/delete policy -- the RPC below is the only
-- way this table changes.

-- record_anagram_quest_difficulty_result() -- the ONLY way this table
-- changes. Called once per completed game, alongside (not instead of) the
-- existing record_game_result()/award_xp() calls.
create or replace function public.record_anagram_quest_difficulty_result(
  p_difficulty text,
  p_score int,
  p_nine_letter_count int
)
returns table (
  easy_high_score int, medium_high_score int, hard_high_score int,
  easy_nine_count int, medium_nine_count int, hard_nine_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := greatest(0, least(coalesce(p_score, 0), 100000));
  v_nine int := greatest(0, least(coalesce(p_nine_letter_count, 0), 5));
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;
  if p_difficulty not in ('EASY', 'MEDIUM', 'HARD') then
    raise exception 'Invalid difficulty: %', p_difficulty;
  end if;

  insert into public.anagram_quest_stats (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  if p_difficulty = 'EASY' then
    update public.anagram_quest_stats t
      set easy_high_score = greatest(t.easy_high_score, v_score),
          easy_nine_count = t.easy_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  elsif p_difficulty = 'MEDIUM' then
    update public.anagram_quest_stats t
      set medium_high_score = greatest(t.medium_high_score, v_score),
          medium_nine_count = t.medium_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  else
    update public.anagram_quest_stats t
      set hard_high_score = greatest(t.hard_high_score, v_score),
          hard_nine_count = t.hard_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  end if;

  return query
    select gs.easy_high_score, gs.medium_high_score, gs.hard_high_score,
           gs.easy_nine_count, gs.medium_nine_count, gs.hard_nine_count
    from public.anagram_quest_stats gs
    where gs.user_id = v_uid;
end;
$$;

grant execute on function public.record_anagram_quest_difficulty_result(text, int, int) to authenticated;

-- ============================================================================
-- Players -- public player search + public player profiles (see
-- supabase/migrations/20260906060000_players_search_and_public_profiles.sql
-- and 20260906070000_players_search_avatar_thumbnails.sql -- the
-- search_public_players() below is already that final, thumbnail-carrying
-- version).
--
-- Same controlled-read pattern as Highscores above: RLS on profiles/
-- equipped_items/avatar_customization is (correctly) locked to "your own
-- row or an admin", so these two SECURITY DEFINER RPCs exist specifically
-- to let an anonymous or logged-in visitor look up ANOTHER account's public
-- showcase -- each one hand-picks EXACTLY the public columns it returns.
-- Both are READ-ONLY. Exclusion rules match Highscores exactly (active and
-- temp-banned included, permanently banned/hidden excluded, deleted rows
-- simply don't exist, test accounts admin-only).
-- ============================================================================

-- search_public_players() -- powers the live Players search box. Matching
-- is case-insensitive substring via position()/lower() (not ILIKE, so a
-- literal `%`/`_` in the query is plain text, not a wildcard), ordered with
-- prefix matches first, then alphabetically. Also returns each match's
-- avatar showcase fields, so a search result can show that account's real
-- front-facing avatar instead of a placeholder icon. An empty/blank query
-- returns zero rows deliberately.
create or replace function public.search_public_players(p_query text, p_limit int default 20, p_offset int default 0)
returns table (
  user_id uuid,
  username text,
  is_banned boolean,
  avatar_gender text,
  avatar_skin_colour text,
  avatar_hair_style text,
  avatar_hair_colour text,
  equipped_items jsonb,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
begin
  if v_q = '' then
    return;
  end if;

  return query
  with matches as (
    select
      p.id as uid,
      p.username as uname,
      (p.banned_until is not null and p.banned_until > now()) as banned,
      ac.gender as gender,
      ac.skin_colour as skin_colour,
      ac.hair_style as hair_style,
      ac.hair_colour as hair_colour,
      coalesce(
        (select jsonb_agg(jsonb_build_object('slot', e.slot, 'item_id', e.item_id))
         from public.equipped_items e
         where e.user_id = p.id),
        '[]'::jsonb
      ) as items,
      (position(v_q in lower(p.username)) = 1) as is_prefix
    from public.profiles p
    left join public.avatar_customization ac on ac.user_id = p.id
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
      and position(v_q in lower(p.username)) > 0
  )
  select uid, uname, banned, gender, skin_colour, hair_style, hair_colour, items,
    count(*) over () as total_count
  from matches
  order by is_prefix desc, uname asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.search_public_players(text, int, int) to anon, authenticated;

-- get_public_player_profile() -- powers the public Player Profile page.
-- Case-insensitive EXACT username match -- a profile lookup, not a search.
-- Returns zero rows for "not found", "permanently banned", "hidden", and
-- "deleted" alike, on purpose: a public profile URL must not be able to
-- distinguish those from each other. equipped_items is returned as a jsonb
-- array of {slot, item_id} only -- the client already owns the full item
-- catalog client-side (assets/js/inventory-data.js) and looks up art/name/
-- etc. from that.
create or replace function public.get_public_player_profile(p_username text)
returns table (
  user_id uuid,
  username text,
  is_banned boolean,
  quest_points integer,
  avatar_gender text,
  avatar_skin_colour text,
  avatar_hair_style text,
  avatar_hair_colour text,
  equipped_items jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select p.id into v_user_id
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(p_username, '')))
    and not p.banned_permanently
    and not p.is_hidden
    and (not p.is_test_account or public.is_admin());

  if v_user_id is null then
    return; -- empty result set = "not found" to the caller
  end if;

  return query
  select
    p.id,
    p.username,
    (p.banned_until is not null and p.banned_until > now()) as is_banned,
    p.quest_points,
    ac.gender,
    ac.skin_colour,
    ac.hair_style,
    ac.hair_colour,
    coalesce(
      (select jsonb_agg(jsonb_build_object('slot', e.slot, 'item_id', e.item_id))
       from public.equipped_items e
       where e.user_id = p.id),
      '[]'::jsonb
    ) as equipped_items
  from public.profiles p
  left join public.avatar_customization ac on ac.user_id = p.id
  where p.id = v_user_id;
end;
$$;

grant execute on function public.get_public_player_profile(text) to anon, authenticated;

-- ============================================================================
-- Email verification -- decoupled from Supabase Auth's own confirmation
-- gate (see supabase/migrations/20260906080000_email_verification.sql).
--
-- Why decoupled: Supabase Auth's native "Confirm email" setting makes the
-- ENTIRE signUp() call fail -- no account created at all -- if sending the
-- confirmation email errors (confirmed live on this project: signups
-- 500'd with "Error sending confirmation email" and left zero rows in
-- auth.users). That's the opposite of what's wanted: signup must always
-- succeed and log the player in immediately, with verification tracked
-- and retryable afterward rather than blocking anything up front.
--
-- So auth.email.enable_confirmations stays OFF (see supabase/config.toml
-- -- accounts are auto-confirmed by Supabase's own bookkeeping at signup,
-- which is why auth.users.email_confirmed_at can't be reused as "did this
-- player actually verify their real inbox" -- it's always set
-- immediately). This adds Quest Zone's OWN verification flag instead:
--   1. assets/js/qz-auth.js sends a 6-digit email OTP via
--      client.auth.signInWithOtp() right after signup (best-effort) and
--      again on demand from the "Resend" button in the email-verification
--      modal (assets/js/email-verify-modal.js).
--   2. The player enters that code in the modal; the client verifies it
--      via client.auth.verifyOtp({ type: 'email', ... }) -- Supabase's own
--      auth server is the one that actually checks the code.
--   3. Only on a SUCCESSFUL verifyOtp() does the client call
--      mark_email_verified() below.
--
-- Every account that already existed as of this migration signed up under
-- the OLD (real Supabase confirmation) flow and was actively in use -- it
-- is grandfathered in as already-verified (email_verified_at = created_at)
-- rather than suddenly locked out of its own profile. A fresh install has
-- no such accounts to grandfather; that UPDATE is then a no-op.
-- ============================================================================

alter table public.profiles add column if not exists email_verified_at timestamptz;

update public.profiles set email_verified_at = created_at where email_verified_at is null;

-- mark_email_verified() -- the ONLY way this flag is ever set. Only ever
-- moves null -> now(); calling it again once already verified is a no-op,
-- not an error (idempotent, safe to call defensively from the client).
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

