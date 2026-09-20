-- ============================================================================
-- Pup N Away — Act 2 ("Journey to the Stars") and Act 3 ("From Frost to
-- Flame") level ids + Act-1-completers progression backfill
-- ============================================================================
-- Widens the two server-side level-id allowlists (see
-- 20260918010000_pup_n_away_level_progress.sql and
-- 20260919010000_pup_n_away_level_layouts.sql) to include the 6 new level
-- ids, matching the LEVELS manifest in pup-n-away-config.js exactly. Both
-- functions are re-declared with create-or-replace, so this is safe to run
-- against a live database with existing rows/data — nothing already stored
-- is touched.
-- ============================================================================
create or replace function public.record_pup_n_away_level_complete(
  p_level_id text, p_score int default 0, p_time_ms int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := greatest(0, least(coalesce(p_score, 0), 999999));
  v_time int := greatest(0, least(coalesce(p_time_ms, 0), 3600000));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;
  if p_level_id is null or p_level_id not in (
    'dream-bedroom', 'back-garden', 'house-rooftop',
    'above-the-city', 'cloud-ascent', 'dream-space',
    'mountain-crossing', 'ore-lit-ravine', 'heart-of-the-deep'
  ) then
    raise exception 'Unknown level.';
  end if;

  insert into public.pup_n_away_level_completions (user_id, level_id, best_score, best_time_ms, times_completed)
    values (v_uid, p_level_id, v_score, v_time, 1)
    on conflict (user_id, level_id) do update
      set best_score = greatest(public.pup_n_away_level_completions.best_score, v_score),
          best_time_ms = case
            when public.pup_n_away_level_completions.best_time_ms <= 0 then v_time
            else least(public.pup_n_away_level_completions.best_time_ms, v_time)
          end,
          times_completed = public.pup_n_away_level_completions.times_completed + 1,
          updated_at = now();
end;
$$;
grant execute on function public.record_pup_n_away_level_complete(text, int, int) to authenticated;
revoke execute on function public.record_pup_n_away_level_complete(text, int, int) from public, anon;

create or replace function public.pna_level_layouts_check_level_id(p_level_id text)
returns void
language plpgsql
as $$
begin
  if p_level_id is null or p_level_id not in (
    'dream-bedroom', 'back-garden', 'house-rooftop',
    'above-the-city', 'cloud-ascent', 'dream-space',
    'mountain-crossing', 'ore-lit-ravine', 'heart-of-the-deep'
  ) then
    raise exception 'Unknown level.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------
-- Backfill: any existing player who has already completed all 3 Act 1
-- levels gets Act 2 unlocked immediately, without waiting for them to
-- trigger record_pup_n_away_act_complete(1) themselves (they already did
-- the qualifying work before Act 2 existed to unlock). Players who are
-- mid-Act-1 are completely untouched — highest_unlocked_act only ever
-- moves UP here, never down, and only ever to exactly 2 (never past it),
-- so this can never over-unlock anyone or corrupt in-progress state.
-- Safe to re-run: the insert/update always converges on the same value
-- for a fully-Act-1-complete player, so replaying this migration is a
-- no-op the second time.
-- ----------------------------------------------------------------------
insert into public.pup_n_away_progression (user_id, highest_unlocked_act, completed_acts)
select
  c.user_id,
  2,
  '[1]'::jsonb
from (
  select user_id
  from public.pup_n_away_level_completions
  where level_id in ('dream-bedroom', 'back-garden', 'house-rooftop')
  group by user_id
  having count(distinct level_id) = 3
) c
on conflict (user_id) do update
  set highest_unlocked_act = greatest(public.pup_n_away_progression.highest_unlocked_act, 2),
      completed_acts = case
        when public.pup_n_away_progression.completed_acts @> to_jsonb(1)
          then public.pup_n_away_progression.completed_acts
        else public.pup_n_away_progression.completed_acts || to_jsonb(1)
      end,
      updated_at = now();
