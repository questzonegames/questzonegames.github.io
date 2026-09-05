-- ============================================================================
-- Hide Claude-created test accounts from public Highscores — visible only
-- to admins (same account, same permission level as James).
--
-- Uses a real `is_test_account` flag rather than matching on a "qz_"
-- username prefix: a naming convention is fragile (a real player could
-- pick a username starting with qz_; a future test account might not
-- follow that pattern at all) and isn't something RLS/RPCs can enforce
-- cleanly. An explicit boolean, defaulting to false for every real
-- account, is the correct, narrow, easy-to-audit way to do this.
-- ============================================================================

alter table public.profiles add column if not exists is_test_account boolean not null default false;

-- Mark the current, known Claude-created test accounts (created across
-- earlier sessions while testing signup/ban/XP flows) — identified by
-- querying the live profiles table first, not guessed from memory.
update public.profiles
   set is_test_account = true
 where lower(username) in (
   'qz_testplayer1', 'qz_freshtest2', 'qz_confirmtest3', 'qz_resendtest1', 'qz_bantest1'
 );

-- ----------------------------------------------------------------------------
-- admin_set_test_account() — the only way this flag changes going
-- forward, so any test account I create later can be flagged (or a real
-- account un-flagged, if this was ever set by mistake) without needing a
-- new migration each time. Same controlled-write-path pattern as every
-- other admin_* function: SECURITY DEFINER + explicit is_admin() check.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Highscores: exclude test accounts unless the CALLER is an admin.
-- public.is_admin() resolves the CURRENT caller's own admin status (via
-- auth.uid()), which is exactly the three cases asked for:
--   - anonymous visitor  -> auth.uid() is null  -> is_admin() false -> hidden
--   - signed-in, not admin -> is_admin() false -> hidden
--   - signed-in admin (e.g. James) -> is_admin() true -> visible
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
      (select count(*) from public.games)
        + coalesce(sum(least(gp.level, 99) - 1) filter (where gp.user_id is not null), 0) as total_level,
      coalesce(sum(gp.xp) filter (where gp.user_id is not null), 0)::bigint as total_xp
    from public.profiles p
    left join public.game_progress gp on gp.user_id = p.id
    where not public.is_banned(p.id)
      and (not p.is_test_account or public.is_admin())
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
    where gp.game_key = p_game_key
      and not public.is_banned(p.id)
      and (not p.is_test_account or public.is_admin())
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
  v_caller_is_admin boolean := public.is_admin();
begin
  select p.id into v_user_id
  from public.profiles p
  where lower(p.username) = lower(p_username)
    and not public.is_banned(p.id)
    and (not p.is_test_account or v_caller_is_admin);

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
    where not public.is_banned(gp.user_id)
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
  select r.uid, r.uname, r.tlevel, r.txp, r.rnk, sm.skills
  from ranked r, skillmap sm
  where r.uid = v_user_id;
end;
$$;
