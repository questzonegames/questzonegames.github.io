-- ============================================================================
-- Highscores: individual player page (highscores/player.html) shows a
-- blank silhouette avatar circle instead of that player's chosen Profile
-- Picture (see 20260906090000_profile_pictures.sql) — hiscores_player_
-- stats() is the RPC that page calls, and it never returned the field to
-- show. Adding it here, same way search_public_players()/
-- get_public_player_profile() already got it.
--
-- Return type changes -> drop and recreate, same as every other RPC
-- signature change in this schema.
-- ============================================================================

drop function if exists public.hiscores_player_stats(text);

create or replace function public.hiscores_player_stats(p_username text)
returns table (
  user_id uuid,
  username text,
  total_level bigint,
  total_xp bigint,
  overall_rank bigint,
  is_banned boolean,
  equipped_profile_picture_id text,
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
  v_pfp text;
begin
  select p.id, (p.banned_until is not null and p.banned_until > now()), p.equipped_profile_picture_id
    into v_user_id, v_is_banned, v_pfp
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
  select r.uid, r.uname, r.tlevel, r.txp, r.rnk, v_is_banned, v_pfp, sm.skills
  from ranked r, skillmap sm
  where r.uid = v_user_id;
end;
$$;

grant execute on function public.hiscores_player_stats(text) to anon, authenticated;
