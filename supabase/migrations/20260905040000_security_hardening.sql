-- ============================================================================
-- Security hardening pass — see SECURITY.md for the permanent rules this
-- project follows going forward. Every change below is additive/backward
-- compatible: no table is dropped, no data is deleted, no existing client
-- call signature changes shape (award_xp/total_level keep the same
-- parameters and return type).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CRITICAL: award_xp() had no upper bound on p_xp_to_add. Any
-- authenticated player could call it directly (browser console, or any
-- HTTP client hitting /rest/v1/rpc/award_xp) with an arbitrary huge value
-- and instantly max their own XP/level — the RPC only controlled WHO could
-- write (via auth.uid()), not HOW MUCH. This adds the same kind of coarse,
-- sane-range backstop record_game_result() already uses for scores.
--
-- MAX_XP_PER_AWARD_CALL is deliberately generous — well above any
-- legitimate single completed game across every game currently on the
-- site (Anagram Quest tops out well under 100; Space Snake awards
-- 10 * score, and record_game_result already clamps that score to
-- 100,000, so its worst case is 1,000,000) — so no real player's honest
-- result is ever clipped, while a "give myself 2 billion XP" console
-- exploit is now rejected outright.
--
-- This is still a coarse backstop, not full server-side replay
-- validation — the actual word/round/score logic for each game runs
-- client-side (documented in each game's own JS). Closing that
-- completely would mean re-implementing each game's scoring rules in a
-- trusted server context (e.g. a Supabase Edge Function per game) —
-- flagged in the security report as a real, known architectural
-- limitation, not silently glossed over.
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

-- ----------------------------------------------------------------------------
-- 2) Total Level must match real OSRS semantics: virtual levels (past 99)
-- are a display-only concept (see qz-xp.js displayLevel — base is capped
-- at 99, virtual is shown separately) and must NOT inflate the Total
-- Level figure. Previously total_level() summed the raw stored `level`
-- column uncapped, so a skill pushed past level 99 would silently count
-- more than 99 toward Total Level — letting one maxed-out skill distort
-- any future leaderboard relative to players spread evenly across skills.
-- Every skill's contribution is now clamped to 99 here, matching the
-- display logic exactly. XP storage/formula/per-skill level are
-- completely unchanged — only this aggregate's math changes.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3) Function Search Path Mutable (flagged by `supabase db advisors`):
-- these 3 functions didn't pin search_path, unlike every other function
-- in this schema. Low actual exploitability here (none are SECURITY
-- DEFINER), but pinning it is the correct, cheap, zero-risk fix and
-- brings them in line with the rest of the schema's own convention.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4) Least privilege: Postgres grants EXECUTE to PUBLIC by default on a
-- newly created function unless revoked — `supabase db advisors` flagged
-- these 3 as callable directly via /rest/v1/rpc/<name> by anon/
-- authenticated even though none of them are meant to be called that way
-- (osrs_xp_for_level/osrs_level_for_xp are pure internal math helpers only
-- ever called from other functions; handle_new_user is a trigger function
-- — calling it directly would just error since NEW is unbound outside a
-- trigger, but it should never have been reachable as an RPC target at
-- all). This matches the pattern already used for
-- achievement_requirement_met/revoke_unmet_achievements elsewhere in this
-- schema. No client code calls any of these three directly (verified —
-- only a client-side mirror of the XP formula exists, in assets/js/
-- qz-xp.js, which doesn't call the database at all).
-- ----------------------------------------------------------------------------
revoke execute on function public.osrs_xp_for_level(int) from public, anon, authenticated;
revoke execute on function public.osrs_level_for_xp(bigint) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) Username format is currently enforced ONLY client-side (qz-auth.js's
-- signUp() regex) — trivially bypassed by calling supabase.auth.signUp()
-- directly instead of going through QZAuth.signUp(). Every current
-- rendering site already escapes usernames before inserting them as HTML
-- (verified across admin.html, profile/index.html, skill-card.js,
-- achievements.html, guidebook.html), so this isn't an active XSS hole —
-- but a real format constraint at the trusted layer (the database) is
-- still the correct defense-in-depth: it's the one place validation can't
-- be skipped by calling the API a different way, and it protects any
-- future rendering site that might forget to escape. Verified safe against
-- every existing account first (all current usernames are 4-15 chars,
-- letters/digits/underscore only) — this will not lock anyone out.
-- ----------------------------------------------------------------------------
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
