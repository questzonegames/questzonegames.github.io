-- ============================================================================
-- Quest Zone — accounts, XP/leveling, inventory schema
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Project → SQL Editor → New query
-- → paste this whole file → Run) on a fresh project. It is safe to re-run:
-- every statement is guarded with IF NOT EXISTS / OR REPLACE / DROP-then-
-- CREATE for policies, so re-running just re-applies the same end state.
--
-- After running this once, make YOUR OWN account an admin (see the very
-- bottom of this file for the exact command — run it AFTER you've signed up
-- through the real Quest Zone signup form).
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
