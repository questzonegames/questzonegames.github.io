-- ============================================================================
-- Fix #2 for unlock_achievement()'s "ambiguous column" error: the previous
-- fix (table-aliasing every reference) wasn't actually enough — a RETURNS
-- TABLE column name becomes a PL/pgSQL variable for the WHOLE function
-- body, and Postgres treats ANY bare occurrence of that identifier text
-- as ambiguous, including as a column name inside an INSERT's column
-- list (`insert into t (user_id, achievement_id) values (...)`), which
-- table-qualification can't fix since a column list isn't a qualifiable
-- reference. Real fix: stop returning a column named achievement_id at
-- all — no caller (assets/js/qz-achievements.js) ever reads it back off
-- the RPC response anyway, it already knows the id it just asked to
-- unlock. Only newly_unlocked/unlocked_at are actually used.
-- ============================================================================
-- return type is changing (dropped the achievement_id output column),
-- which postgres won't allow via plain create-or-replace
drop function if exists public.unlock_achievement(text);

create or replace function public.unlock_achievement(p_achievement_id text)
returns table (newly_unlocked boolean, unlocked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ach public.achievements%rowtype;
  v_already boolean;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;

  select * into v_ach from public.achievements ach where ach.achievement_id = p_achievement_id;
  if v_ach.achievement_id is null then
    raise exception 'Unknown achievement: %', p_achievement_id;
  end if;

  select exists(
    select 1 from public.unlocked_achievements ua
    where ua.user_id = v_uid and ua.achievement_id = p_achievement_id
  ) into v_already;
  if v_already then
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select false, v_at;
    return;
  end if;

  if v_ach.requirement_type is not null and not public.achievement_requirement_met(v_uid, p_achievement_id) then
    return query select false, null::timestamptz;
    return;
  end if;

  insert into public.unlocked_achievements (user_id, achievement_id)
    values (v_uid, p_achievement_id)
    on conflict (user_id, achievement_id) do nothing
    returning unlocked_achievements.unlocked_at into v_at;

  if v_at is null then
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select false, v_at;
    return;
  end if;

  return query select true, v_at;
end;
$$;
grant execute on function public.unlock_achievement(text) to authenticated;
