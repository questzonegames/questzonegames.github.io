-- ============================================================================
-- Site-wide Achievements system — schema extensions + unlock RPC + seed data
-- ============================================================================
-- public.achievements/unlocked_achievements/pinned_achievements already
-- exist (see schema.sql) with the catalog/unlock/pin shape and RLS already
-- in place. This migration:
--   1. adds the columns the new profile/achievements.html page needs
--      (category, game_key, hidden) that the catalog didn't have yet,
--   2. broadens requirement_type + achievement_requirement_met() to cover
--      two more stat sources (games_played, high_score) alongside the
--      existing total_level/game_xp/game_level, so "Play 10 Games" /
--      "Score 30 Points"-style achievements are real, not fabricated,
--   3. adds unlock_achievement() — the ONE reusable entry point any game
--      calls to grant an achievement, verified server-side whenever the
--      achievement has a requirement_type (never trusts the client for
--      those), and simply idempotent-inserts for requirement-less "event"
--      achievements (first-word/first-game/etc — nothing to verify
--      against a stored stat, so these stay trust-the-caller like most
--      other non-competitive client actions on this site),
--   4. seeds the small placeholder achievement set from the feature spec.
-- ============================================================================

-- ---- 1. new catalog columns ----
-- game_key here is a purely cosmetic/filtering label (the game's own
-- slug, e.g. 'anagram-quest' — NOT an FK to public.games, which is the
-- skill/XP registry a game may or may not participate in). Deliberately
-- decoupled from requirement_game_key (below, FK'd to public.games)
-- which is ONLY used for verifying a stat-based requirement — so a game
-- with no skill of its own (Space Snake) can still have achievements
-- filterable by "game" without needing a fake games-table row.
alter table public.achievements add column if not exists category text;
alter table public.achievements add column if not exists game_key text;
alter table public.achievements add column if not exists hidden boolean not null default false;

-- ---- 2. broaden requirement_type ----
alter table public.achievements drop constraint if exists achievements_requirement_type_check;
alter table public.achievements
  add constraint achievements_requirement_type_check
  check (requirement_type is null or requirement_type in (
    'total_level', 'game_xp', 'game_level', -- pre-existing
    'games_played', 'high_score'            -- new
  ));

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
  v_val bigint;
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
  elsif a.requirement_type = 'games_played' then
    select games_played into v_val from public.game_stats where user_id = p_user and game_key = a.requirement_game_key;
    return coalesce(v_val, 0) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'high_score' then
    select high_score into v_val from public.game_stats where user_id = p_user and game_key = a.requirement_game_key;
    return coalesce(v_val, 0) >= coalesce(a.requirement_value, 0);
  end if;
  return true;
end;
$$;
revoke execute on function public.achievement_requirement_met(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- unlock_achievement() — THE reusable entry point every game/page calls to
-- grant an achievement (see docs in profile/achievements.html report to
-- the user for the exact JS wrapper). security definer so it can insert
-- into unlocked_achievements despite that table having no client insert
-- policy (deliberately — see schema.sql's own comment on that table).
--
-- Verification: if the achievement HAS a requirement_type, the award is
-- checked against the player's own already-recorded, server-written stats
-- via achievement_requirement_met() — a client cannot unlock e.g. "Play 10
-- Games" without games_played actually being >= 10 in game_stats, which
-- only record_game_result() ever writes. An achievement with NO
-- requirement_type (an "event" achievement — first-word, first-login, ...)
-- has no stored stat to check against by design, so it's granted on the
-- caller's word, same trust level as any other purely-cosmetic client
-- action on this site (nothing here can inflate XP, currency, or a
-- leaderboard).
--
-- Idempotent: unlocking an already-unlocked achievement is a harmless
-- no-op (returns newly_unlocked=false), never an error, so callers can
-- always call this unconditionally (e.g. "every valid word submitted")
-- instead of tracking "have I already sent this one" client-side.
-- ----------------------------------------------------------------------------
create or replace function public.unlock_achievement(p_achievement_id text)
returns table (achievement_id text, newly_unlocked boolean, unlocked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a public.achievements%rowtype;
  v_already boolean;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;

  select * into a from public.achievements where achievement_id = p_achievement_id;
  if a.achievement_id is null then
    raise exception 'Unknown achievement: %', p_achievement_id;
  end if;

  select exists(
    select 1 from public.unlocked_achievements
    where user_id = v_uid and achievement_id = p_achievement_id
  ) into v_already;
  if v_already then
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select p_achievement_id, false, v_at;
    return;
  end if;

  if a.requirement_type is not null and not public.achievement_requirement_met(v_uid, p_achievement_id) then
    -- Not actually earned yet — silently declined, not an error, so a
    -- caller can call this speculatively (e.g. "check all stat
    -- achievements after every game") without special-casing failure.
    return query select p_achievement_id, false, null::timestamptz;
    return;
  end if;

  insert into public.unlocked_achievements (user_id, achievement_id)
    values (v_uid, p_achievement_id)
    on conflict (user_id, achievement_id) do nothing
    returning unlocked_achievements.unlocked_at into v_at;

  if v_at is null then
    -- lost a race with a concurrent call — treat exactly like "already had it"
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select p_achievement_id, false, v_at;
    return;
  end if;

  return query select p_achievement_id, true, v_at;
end;
$$;
grant execute on function public.unlock_achievement(text) to authenticated;

-- ---- 4. seed placeholder achievements (feature-test set — see the JS
-- report for how to add/replace these later; safe to re-run, upserts by
-- primary key) ----
insert into public.achievements
  (achievement_id, name, description, icon, tier, sort_order, category, game_key, requirement_type, requirement_game_key, requirement_value)
values
  ('anagram_first_word', 'First Word', 'Submit your first valid word in Anagram Quest.', '📝', 'bronze', 100, 'games', 'anagram-quest', null, null, null),
  ('anagram_first_game', 'First Game', 'Complete your first Anagram Quest game.', '🎮', 'bronze', 110, 'games', 'anagram-quest', null, null, null),
  ('anagram_first_7', 'Seven Up', 'Find your first 7-letter word in Anagram Quest.', '🔤', 'silver', 120, 'games', 'anagram-quest', null, null, null),
  ('anagram_first_8', 'Eight Great', 'Find your first 8-letter word in Anagram Quest.', '🔡', 'silver', 130, 'games', 'anagram-quest', null, null, null),
  ('anagram_first_9', 'Nine Divine', 'Find your first 9-letter word in Anagram Quest.', '✨', 'gold', 140, 'games', 'anagram-quest', null, null, null),
  ('anagram_first_final', 'Final Word', 'Solve your first Final Round in Anagram Quest.', '🏁', 'gold', 150, 'games', 'anagram-quest', null, null, null),
  ('anagram_score_30', 'Score 30 Points', 'Score 30 points or more in a single Anagram Quest game.', '⭐', 'bronze', 160, 'games', 'anagram-quest', 'high_score', 'intelligence', 30),
  ('anagram_score_50', 'Score 50 Points', 'Score 50 points or more in a single Anagram Quest game.', '🌟', 'silver', 170, 'games', 'anagram-quest', 'high_score', 'intelligence', 50),
  ('anagram_play_10', 'Regular Player', 'Play 10 games of Anagram Quest.', '🔁', 'bronze', 180, 'games', 'anagram-quest', 'games_played', 'intelligence', 10),

  ('intel_level_10', 'Intelligence I', 'Reach Intelligence Level 10.', '🧠', 'bronze', 200, 'levels', 'anagram-quest', 'game_level', 'intelligence', 10),
  ('intel_level_25', 'Intelligence II', 'Reach Intelligence Level 25.', '🧠', 'silver', 210, 'levels', 'anagram-quest', 'game_level', 'intelligence', 25),
  ('intel_level_50', 'Intelligence III', 'Reach Intelligence Level 50.', '🧠', 'gold', 220, 'levels', 'anagram-quest', 'game_level', 'intelligence', 50),

  ('misc_first_login', 'Welcome to Quest Zone', 'Sign in to Quest Zone for the first time.', '👋', 'bronze', 300, 'misc', null, null, null, null)
on conflict (achievement_id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  tier = excluded.tier,
  sort_order = excluded.sort_order,
  category = excluded.category,
  game_key = excluded.game_key,
  requirement_type = excluded.requirement_type,
  requirement_game_key = excluded.requirement_game_key,
  requirement_value = excluded.requirement_value;
