-- ============================================================================
-- Players — public player search + public player profiles.
-- ============================================================================
-- Same controlled-read pattern as 20260905050000_public_highscores.sql: RLS on
-- profiles/equipped_items/avatar_customization is (correctly) locked to "your
-- own row or an admin", so these two SECURITY DEFINER RPCs exist specifically
-- to let an anonymous or logged-in visitor look up ANOTHER account's public
-- showcase — and each one hand-picks EXACTLY the public columns it returns.
--
-- Both are READ-ONLY. Neither writes to any table.
--
-- Exclusion rules match the "four account states" from
-- 20260906050000_admin_hide_and_delete_accounts.sql exactly:
--   - Active            -> included
--   - Temp-banned       -> included, with is_banned = true so the client can
--                          show a "TEMPORARILY BANNED" badge
--   - Permanently banned -> excluded entirely (never in search, "not found"
--                          on a direct profile lookup)
--   - Hidden            -> excluded entirely, same as Highscores
--   - Deleted           -> the row is simply gone, so it's already excluded
--                          by the FROM clause — nothing extra needed
-- Test accounts follow the same "hidden unless the caller is an admin" rule
-- already used by hiscores_*().
--
-- Skill levels for a public profile are NOT duplicated here — the client
-- calls the existing public.hiscores_player_stats(username) for those,
-- which already applies this identical exclusion + is_test_account logic.
-- This migration only adds what that one doesn't already cover: search, and
-- the public avatar/quest-points showcase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- search_public_players() — powers the live Players search box. Matching is
-- case-insensitive substring (not just prefix), but results are ordered with
-- prefix matches first, then alphabetically — "Jam" ranks James/Jamie ahead
-- of SuperJames, exactly as spec'd.
--
-- Uses position()/lower() rather than ILIKE so a search string containing
-- literal `%` or `_` is treated as plain text instead of a wildcard pattern.
--
-- An empty/blank query returns zero rows deliberately — Players should never
-- dump every account onto the page before the visitor has typed anything;
-- that's enforced here, not just left to the frontend to not-call.
-- ----------------------------------------------------------------------------
create or replace function public.search_public_players(p_query text, p_limit int default 20, p_offset int default 0)
returns table (
  user_id uuid,
  username text,
  is_banned boolean,
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
      (position(v_q in lower(p.username)) = 1) as is_prefix
    from public.profiles p
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
      and position(v_q in lower(p.username)) > 0
  )
  select uid, uname, banned, count(*) over () as total_count
  from matches
  order by is_prefix desc, uname asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.search_public_players(text, int, int) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- get_public_player_profile() — powers the public Player Profile page.
-- Case-insensitive EXACT username match (same convention as
-- hiscores_player_stats/email_for_username elsewhere) — this is a profile
-- lookup, not a search. Returns zero rows for "not found", "permanently
-- banned", "hidden", and "deleted" alike, on purpose: a public profile URL
-- must not be able to distinguish those from each other.
--
-- equipped_items is returned as a jsonb array of {slot, item_id} only — the
-- client already owns the full item catalog client-side (assets/js/
-- inventory-data.js) and looks up art/name/etc. from that, exactly like
-- profile/index.html's own applyRealEquipment() does for the signed-in
-- account. Nothing about *how* an item is drawn is duplicated into the
-- database.
-- ----------------------------------------------------------------------------
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
