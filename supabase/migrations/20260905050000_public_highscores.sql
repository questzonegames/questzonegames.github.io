-- ============================================================================
-- Public Highscores — read-only leaderboard RPCs.
-- ============================================================================
-- Why SECURITY DEFINER: profiles/game_progress RLS is (correctly) locked to
-- "your own row or an admin" — a normal or anon caller querying those
-- tables directly sees nothing useful for a leaderboard. These functions
-- run with elevated privileges specifically so they can rank across every
-- account, but each one hand-picks EXACTLY the public columns it returns
-- (username, level, xp, rank) — never email, ban details, quest_points,
-- is_admin, or anything else. This is the same controlled-read pattern
-- already used by total_level()/is_admin()/email_for_username() elsewhere
-- in this schema, just applied to a set-returning, paginated query.
--
-- These are READ-ONLY. None of them write to any table — highscores can
-- never be used to change XP, levels, or anything else. That security
-- model is unchanged; this migration only adds new SELECT-shaped RPCs.
--
-- Banned accounts are excluded from every result below (ranking, search,
-- and compare) — a deliberate product decision (public leaderboards
-- shouldn't surface banned/likely-cheating accounts), not a security
-- requirement. Easy to revisit later if that's not what's wanted.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- hiscores_overall() — Total Level + Total XP across every real skill, for
-- every registered account (an account that has never played anything
-- still appears, at the baseline Total Level = count(games)). Total Level
-- caps each skill's contribution at 99 — matches total_level()'s existing
-- OSRS-accurate math exactly (see 20260905040000_security_hardening.sql):
-- virtual levels never inflate Total Level. Total XP is real, uncapped-
-- per-skill XP summed (a skill's own stored XP is already capped at
-- 2,147,483,647 by game_progress's own CHECK constraint).
-- ----------------------------------------------------------------------------
create or replace function public.hiscores_overall(p_limit int default 25, p_offset int default 0)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  total_level bigint,
  total_xp bigint,
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
      (select count(*) from public.games) + coalesce(sum(least(gp.level, 99) - 1), 0) as total_level,
      coalesce(sum(gp.xp), 0) as total_xp
    from public.profiles p
    left join public.game_progress gp on gp.user_id = p.id
    where not public.is_banned(p.id)
    group by p.id, p.username
  )
  select
    row_number() over (order by total_level desc, total_xp desc, username asc) as rank,
    user_id, username, total_level, total_xp,
    count(*) over () as total_count
  from totals
  order by total_level desc, total_xp desc, username asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.hiscores_overall(int, int) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- hiscores_skill() — a single skill's leaderboard. Unlike Overall, only
-- accounts that have actually gained XP in this skill appear (matches real
-- OSRS's "unranked until trained" behaviour) — a brand-new account isn't
-- shown as "level 1, 0 XP, rank #4,000" cluttering every skill's list.
-- p_game_key must be a real row in public.games (currently just
-- 'intelligence'); an unknown key simply returns zero rows.
-- ----------------------------------------------------------------------------
create or replace function public.hiscores_skill(p_game_key text, p_limit int default 25, p_offset int default 0)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  level int,
  xp bigint,
  total_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with rows as (
    select p.id as user_id, p.username, gp.level, gp.xp
    from public.game_progress gp
    join public.profiles p on p.id = gp.user_id
    where gp.game_key = p_game_key and not public.is_banned(p.id)
  )
  select
    row_number() over (order by level desc, xp desc, username asc) as rank,
    user_id, username, level, xp,
    count(*) over () as total_count
  from rows
  order by level desc, xp desc, username asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.hiscores_skill(text, int, int) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- hiscores_player_stats() — powers both Search and Compare. Case-
-- insensitive exact username match (same convention as email_for_username/
-- ban_message_for_login elsewhere in this schema); returns zero rows if no
-- such account exists or it's banned (indistinguishable from "not found" —
-- doesn't reveal a banned account's existence any more than it would leak
-- whether an email exists elsewhere in this schema).
--
-- `skills` is a jsonb map of every real game_key -> {level, xp, rank},
-- rather than one column per skill, specifically so adding a new skill to
-- public.games later needs zero changes here — the client already reads
-- this generically against its own skill registry.
-- `rank` inside `skills` is null for a skill the player has never gained
-- XP in (same "unranked" convention as hiscores_skill above).
-- ----------------------------------------------------------------------------
create or replace function public.hiscores_player_stats(p_username text)
returns table (
  user_id uuid,
  username text,
  total_level bigint,
  total_xp bigint,
  overall_rank bigint,
  skills jsonb
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
  where lower(p.username) = lower(p_username) and not public.is_banned(p.id);

  if v_user_id is null then
    return; -- empty result set = "not found" to the caller
  end if;

  return query
  with totals as (
    select
      p.id as uid,
      p.username as uname,
      (select count(*) from public.games) + coalesce(sum(least(gp.level, 99) - 1), 0) as tlevel,
      coalesce(sum(gp.xp), 0) as txp
    from public.profiles p
    left join public.game_progress gp on gp.user_id = p.id
    where not public.is_banned(p.id)
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
    where not public.is_banned(gp.user_id)
  ),
  skillmap as (
    select jsonb_object_agg(
      g.game_key,
      jsonb_build_object('level', coalesce(sr.level, 1), 'xp', coalesce(sr.xp, 0), 'rank', sr.srank)
    ) as skills
    from public.games g
    left join skill_ranks sr on sr.game_key = g.game_key and sr.user_id = v_user_id
  )
  select r.uid, r.uname, r.tlevel, r.txp, r.rnk, sm.skills
  from ranked r, skillmap sm
  where r.uid = v_user_id;
end;
$$;

grant execute on function public.hiscores_player_stats(text) to anon, authenticated;
