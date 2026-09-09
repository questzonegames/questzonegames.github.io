-- ============================================================================
-- Fix: unlock_achievement() raised "column reference achievement_id is
-- ambiguous" (Postgres 42702) — its RETURNS TABLE(achievement_id text, ...)
-- makes `achievement_id` an implicit PL/pgSQL variable in the function's
-- own scope, which collided with the bare `achievement_id` column
-- references inside its queries. Fix: alias every table touched and
-- rename the local achievements-row variable away from anything that
-- could collide with an OUT parameter name.
-- ============================================================================
create or replace function public.unlock_achievement(p_achievement_id text)
returns table (achievement_id text, newly_unlocked boolean, unlocked_at timestamptz)
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
    return query select p_achievement_id, false, v_at;
    return;
  end if;

  if v_ach.requirement_type is not null and not public.achievement_requirement_met(v_uid, p_achievement_id) then
    return query select p_achievement_id, false, null::timestamptz;
    return;
  end if;

  insert into public.unlocked_achievements (user_id, achievement_id)
    values (v_uid, p_achievement_id)
    on conflict (user_id, achievement_id) do nothing
    returning unlocked_achievements.unlocked_at into v_at;

  if v_at is null then
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select p_achievement_id, false, v_at;
    return;
  end if;

  return query select p_achievement_id, true, v_at;
end;
$$;
grant execute on function public.unlock_achievement(text) to authenticated;
