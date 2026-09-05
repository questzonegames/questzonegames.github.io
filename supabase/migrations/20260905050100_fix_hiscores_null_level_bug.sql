-- ============================================================================
-- Fix: hiscores_overall()/hiscores_player_stats() computed Total Level
-- wrong for any account with ZERO game_progress rows (i.e. never played
-- anything) — found while live-testing the previous migration, before this
-- was ever exposed to a real page.
--
-- Root cause: `LEAST(gp.level, 99)` where `gp.level` is NULL (the row
-- produced by a LEFT JOIN with no match) does NOT evaluate to NULL in
-- Postgres — LEAST()/GREATEST() explicitly ignore NULL arguments and
-- return the least/greatest of whatever's left (here, just 99). So an
-- unplayed-everything account was getting `least(NULL,99) - 1 = 98`
-- silently summed in, inflating their Total Level to 99 instead of the
-- correct baseline of 1. total_level() (singular, per-user — see the
-- security hardening migration) never hit this because it aggregates via
-- a scalar subquery that has zero rows to sum over when nothing's been
-- played, which correctly stays NULL — a LEFT JOIN across every user for
-- the leaderboard is a different shape that needed its own explicit guard.
--
-- Fix: exclude the LEFT JOIN's placeholder (all-null) row from the sum
-- with a FILTER clause keyed on gp.user_id, which is only null on that
-- placeholder row, never on a genuine match.
-- ============================================================================

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
      (select count(*) from public.games)
        + coalesce(sum(least(gp.level, 99) - 1) filter (where gp.user_id is not null), 0) as total_level,
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0) as total_xp
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
    return;
  end if;

  return query
  with totals as (
    select
      p.id as uid,
      p.username as uname,
      (select count(*) from public.games)
        + coalesce(sum(least(gp.level, 99) - 1) filter (where gp.user_id is not null), 0) as tlevel,
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0) as txp
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
