-- ============================================================================
-- Admin Zone phase 2 — editing controls from the admin-view Profile page:
-- set a player's XP per skill, remove an inventory item, remove an
-- unlocked achievement, and auto-revoke any achievement a player no
-- longer qualifies for after their stats change. Ban/unban already exist
-- (admin_ban_user/admin_unban_user from the admin_bans migration) and are
-- just being surfaced in a new spot in the UI — nothing new needed for
-- those here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- achievements gets an optional formal requirement, so it's possible to
-- tell whether a given unlock is still earned after an admin edits XP.
-- Nullable/no-op by design: an achievement with no requirement_type (e.g.
-- a manually-granted or event achievement) is never auto-revoked — only
-- ones explicitly tied to a stat are.
-- ----------------------------------------------------------------------------
alter table public.achievements add column if not exists requirement_type text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'achievements_requirement_type_check'
  ) then
    alter table public.achievements
      add constraint achievements_requirement_type_check
      check (requirement_type is null or requirement_type in ('total_level', 'game_xp', 'game_level'));
  end if;
end $$;
alter table public.achievements add column if not exists requirement_game_key text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'achievements_requirement_game_key_fkey'
  ) then
    alter table public.achievements
      add constraint achievements_requirement_game_key_fkey
      foreign key (requirement_game_key) references public.games(game_key)
      on update cascade on delete set null;
  end if;
end $$;
alter table public.achievements add column if not exists requirement_value bigint;

-- ----------------------------------------------------------------------------
-- achievement_requirement_met() — true if p_user's CURRENT stats still
-- satisfy p_achievement_id's requirement (or the achievement has no
-- formal requirement at all, in which case it's never auto-revoked).
-- ----------------------------------------------------------------------------
create or replace function public.achievement_requirement_met(p_user uuid, p_achievement_id text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  a public.achievements%rowtype;
  v_xp bigint;
  v_level int;
begin
  select * into a from public.achievements where achievement_id = p_achievement_id;
  if a.achievement_id is null or a.requirement_type is null then
    return true;
  end if;

  if a.requirement_type = 'total_level' then
    return public.total_level(p_user) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'game_xp' then
    select xp into v_xp from public.game_progress where user_id = p_user and game_key = a.requirement_game_key;
    return coalesce(v_xp, 0) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'game_level' then
    select level into v_level from public.game_progress where user_id = p_user and game_key = a.requirement_game_key;
    return coalesce(v_level, 1) >= coalesce(a.requirement_value, 0);
  end if;
  return true;
end;
$$;
revoke execute on function public.achievement_requirement_met(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- revoke_unmet_achievements() — drops any of p_user's unlocked achievements
-- (and matching pinned slot) whose requirement their CURRENT stats no
-- longer satisfy. Internal helper, not called directly by clients — called
-- automatically at the end of admin_set_game_xp() below.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_unmet_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select ua.achievement_id
    from public.unlocked_achievements ua
    join public.achievements a on a.achievement_id = ua.achievement_id
    where ua.user_id = p_user and a.requirement_type is not null
  loop
    if not public.achievement_requirement_met(p_user, r.achievement_id) then
      delete from public.pinned_achievements where user_id = p_user and achievement_id = r.achievement_id;
      delete from public.unlocked_achievements where user_id = p_user and achievement_id = r.achievement_id;
    end if;
  end loop;
end;
$$;
revoke execute on function public.revoke_unmet_achievements(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_set_game_xp() — sets a player's XP for one game to an EXACT value
-- (not additive like award_xp — this is "customise their skills", not
-- "award more"), recalculates level from the same OSRS formula, and then
-- revokes any achievement no longer earned. SECURITY DEFINER + explicit
-- is_admin() check, same controlled-write-path pattern as every other
-- admin_* function.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_game_xp(p_user uuid, p_game_key text, p_xp bigint)
returns table (xp bigint, level int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_level int;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_xp is null or p_xp < 0 or p_xp > 2147483647 then
    raise exception 'XP must be between 0 and 2,147,483,647.';
  end if;

  insert into public.game_progress (user_id, game_key, xp, level)
  values (p_user, p_game_key, 0, 1)
  on conflict (user_id, game_key) do nothing;

  v_new_level := public.osrs_level_for_xp(p_xp);

  update public.game_progress g
    set xp = p_xp, level = v_new_level, updated_at = now()
    where g.user_id = p_user and g.game_key = p_game_key;

  perform public.revoke_unmet_achievements(p_user);

  return query
    select g.xp, g.level from public.game_progress g
    where g.user_id = p_user and g.game_key = p_game_key;
end;
$$;

grant execute on function public.admin_set_game_xp(uuid, text, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_delete_achievement() — removes one unlocked achievement (and clears
-- it from any pinned slot it's showing in) from an account.
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_achievement(p_user uuid, p_achievement_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  delete from public.pinned_achievements where user_id = p_user and achievement_id = p_achievement_id;
  delete from public.unlocked_achievements where user_id = p_user and achievement_id = p_achievement_id;
end;
$$;

grant execute on function public.admin_delete_achievement(uuid, text) to authenticated;
