-- ============================================================================
-- Fix: hiscores_player_stats() failed outright — "structure of query does
-- not match function result type... Returned type numeric does not match
-- expected type bigint" — found while live-testing the previous migration.
--
-- Root cause: Postgres's sum(bigint) returns numeric, not bigint (to avoid
-- silent overflow) — game_progress.xp is bigint, so
-- `coalesce(sum(gp.xp) filter (...), 0)` is numeric. A plain `language sql`
-- function (hiscores_overall) tolerates that via implicit coercion against
-- its declared RETURNS TABLE type, but plpgsql's RETURN QUERY
-- (hiscores_player_stats) requires an exact type match and errors instead.
-- Casting explicitly to ::bigint fixes it in both functions (making
-- hiscores_overall's cast explicit too, rather than relying on the same
-- implicit coercion silently).
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
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0)::bigint as total_xp
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
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0)::bigint as txp
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
