-- ============================================================================
-- Players page — Top 3 Total Level showcase.
-- ============================================================================
-- get_top_total_level_players() powers the 3 cards shown under the search
-- bar on profile/players.html. Same exclusion rules as hiscores_player_
-- stats()/search_public_players(): permanently banned, hidden, and (unless
-- the caller is an admin) test accounts are excluded entirely; temporarily
-- banned accounts ARE included (with is_banned = true so the client can
-- show the same badge Player Search already uses).
--
-- Total Level is computed exactly like hiscores_overall()/hiscores_player_
-- stats() — one real skill per public.games row, virtual levels (>99)
-- capped at 99 for the total — so this automatically stays correct as
-- more skills are added later; nothing here hardcodes a skill list or a
-- skill count.
-- ============================================================================

create or replace function public.get_top_total_level_players(p_limit int default 3)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  total_level bigint,
  total_xp bigint,
  is_banned boolean,
  equipped_profile_picture_id text
)
language sql
security definer
stable
set search_path = public
as $$
  with totals as (
    select
      p.id as uid,
      p.username as uname,
      (p.banned_until is not null and p.banned_until > now()) as banned,
      p.equipped_profile_picture_id as pfp,
      (select count(*) from public.games)
        + coalesce(sum(least(gp.level, 99) - 1) filter (where gp.user_id is not null), 0) as tlevel,
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0)::bigint as txp
    from public.profiles p
    left join public.game_progress gp on gp.user_id = p.id
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
    group by p.id, p.username, p.banned_until, p.equipped_profile_picture_id
  )
  select
    row_number() over (order by tlevel desc, txp desc, uname asc) as rank,
    uid, uname, tlevel, txp, banned, pfp
  from totals
  order by tlevel desc, txp desc, uname asc
  limit least(greatest(coalesce(p_limit, 3), 1), 10);
$$;

grant execute on function public.get_top_total_level_players(int) to anon, authenticated;
