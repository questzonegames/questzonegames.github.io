-- ============================================================================
-- Admin: Hide Account + Delete Account — two new, distinct admin actions
-- alongside the existing temporary/permanent ban.
--
-- The four account states an admin can now put an account into:
--   - Active            — normal, shows everywhere.
--   - Temp-banned        — still shows on Highscores (with a "BANNED" tag
--                          the client renders from the new is_banned column
--                          below), can't log in until banned_until passes.
--                          Username stays reserved (the row still exists).
--   - Permanently banned — hidden from Highscores/search, can never log in
--                          again unless unbanned. The row (and its
--                          username) still exists, so nobody else can ever
--                          register that username while it's banned.
--   - Hidden             — fully reversible, cosmetic-only: doesn't show on
--                          Highscores or player search, but the account
--                          works completely normally otherwise (can still
--                          log in and play). Distinct from a ban: there is
--                          no login block and no is_banned() involvement.
--   - Deleted (not a flag — the row is gone) — every table cascades from
--                          auth.users(id) on delete cascade (see
--                          20260903004123_initial_schema.sql and later
--                          migrations), so deleting the auth.users row
--                          removes the profile, game_progress, inventory,
--                          equipped items, pinned achievements, avatar
--                          customisation and Anagram Quest stats in one
--                          go, and — because profiles_username_lower_idx
--                          is a unique index on the now-gone row — frees
--                          the username for anyone to register again from
--                          scratch, with none of the old account's data.
-- ============================================================================

alter table public.profiles add column if not exists is_hidden boolean not null default false;

-- ----------------------------------------------------------------------------
-- admin_hide_user() / admin_unhide_user() — same controlled-write-path
-- pattern as admin_ban_user/admin_set_test_account: SECURITY DEFINER +
-- explicit is_admin() check, no broad "admins can update anyone" policy.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- admin_delete_account() — permanently deletes an account and every trace
-- of its data, freeing its username for reuse. SECURITY DEFINER so it can
-- reach into auth.users (a normal authenticated role has no privileges
-- there at all) — same elevated-but-narrowly-scoped shape as every other
-- admin_* function here, just reaching one schema further than usual
-- because deleting a user is fundamentally an auth-schema operation.
-- Deletes auth.users directly rather than only public.profiles: every
-- user-owned table references auth.users(id) on delete cascade (not
-- public.profiles), so this is the one delete that actually cascades
-- everywhere. There is no undo — the confirmation lives entirely in the
-- admin UI (profile/admin.html), not here.
-- ----------------------------------------------------------------------------
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
-- Highscores: a temp ban no longer hides an account (it now shows with
-- is_banned = true so the client can render a "BANNED" tag/red name), but
-- a permanent ban and a hidden account both stay excluded entirely — same
-- as public.is_banned() used to exclude both ban types before this
-- migration. Return type changes (added is_banned), so these must be
-- dropped and recreated rather than just CREATE OR REPLACE'd.
-- ----------------------------------------------------------------------------
drop function if exists public.hiscores_overall(int, int);
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

drop function if exists public.hiscores_skill(text, int, int);
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

drop function if exists public.hiscores_player_stats(text);
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
