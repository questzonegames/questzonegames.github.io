-- ============================================================================
-- Anagram Quest achievements — full replacement (v2)
--
-- Retires the entire placeholder achievement set seeded by
-- 20260909020000_achievements_site_wide.sql (9 anagram_* ids + the 3
-- intel_level_* ids, all game_key='anagram-quest') and replaces it with the
-- final 20-achievement design across all 6 tiers. Nothing here touches any
-- OTHER game's achievements (Jack of All Trades, misc, etc).
--
-- New tracking needed beyond what already existed (games_played/high_score
-- in game_stats, easy/medium/hard_high_score + *_nine_count in
-- anagram_quest_stats):
--   - final_rounds_solved      -- cumulative count of successful Round 5
--                                  solves, any difficulty (Final Word /
--                                  Final Form / Nine-Letter Legend /
--                                  Anagram God)
--   - hard_final_round_solved  -- true forever once Round 5 has been solved
--                                  at least once on Hard (Against the Clock)
--   - perfect_game_achieved    -- true forever once a single game scored
--                                  >0 in every one of Rounds 1-4 AND solved
--                                  Round 5 (Five for Five)
-- hard_high_score already exists and is reused as-is for Hard Hitter (55+
-- on Hard) — no new column needed for that one.
--
-- All four new stat-backed requirement types below are verified 100%
-- server-side against these columns — none of Final Word/Final Form/Nine-
-- Letter Legend/Anagram God/Against the Clock/Hard Hitter trust the client
-- at unlock time, only the three pure "did this word length just happen"
-- events (Seven Up/Octoword/Nine Rack) and the "was this a perfect game"
-- event (Five for Five, whose underlying perfect_game_achieved flag is
-- itself computed IN THIS FUNCTION from the round scores the client
-- reports — same trust level the rest of this game's scoring already
-- operates at, since Anagram Quest has no server-authoritative word
-- judging at all).
-- ============================================================================

-- ---- 1. new anagram_quest_stats columns ----
alter table public.anagram_quest_stats add column if not exists final_rounds_solved int not null default 0;
alter table public.anagram_quest_stats add column if not exists hard_final_round_solved boolean not null default false;
alter table public.anagram_quest_stats add column if not exists perfect_game_achieved boolean not null default false;

-- ---- 2. record_anagram_quest_difficulty_result() gains two new params ----
-- CREATE OR REPLACE does NOT replace a function whose parameter list
-- differs (even by adding trailing optional params) — it creates a second
-- overload instead. Must drop the old 3-arg signature explicitly first.
drop function if exists public.record_anagram_quest_difficulty_result(text, int, int);

create or replace function public.record_anagram_quest_difficulty_result(
  p_difficulty text,
  p_score int,
  p_nine_letter_count int,
  p_final_round_solved boolean default false,
  p_round_scores int[] default null
)
returns table (
  easy_high_score int, medium_high_score int, hard_high_score int,
  easy_nine_count int, medium_nine_count int, hard_nine_count int,
  final_rounds_solved int, hard_final_round_solved boolean, perfect_game_achieved boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := greatest(0, least(coalesce(p_score, 0), 100000));
  v_nine int := greatest(0, least(coalesce(p_nine_letter_count, 0), 5));
  -- A perfect game needs exactly 5 round scores, all strictly positive
  -- (Rounds 1-4 each scored something, Round 5 was solved — a 0 in
  -- Round 5's slot means it wasn't). Missing/malformed input (an older
  -- client, or the array never sent) just means "not this time", never an
  -- error — matches every other best-effort stat write in this function.
  v_perfect boolean := p_round_scores is not null and array_length(p_round_scores, 1) = 5
    and p_round_scores[1] > 0 and p_round_scores[2] > 0 and p_round_scores[3] > 0
    and p_round_scores[4] > 0 and p_round_scores[5] > 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;
  if p_difficulty not in ('EASY', 'MEDIUM', 'HARD') then
    raise exception 'Invalid difficulty: %', p_difficulty;
  end if;

  insert into public.anagram_quest_stats (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  if p_difficulty = 'EASY' then
    update public.anagram_quest_stats t
      set easy_high_score = greatest(t.easy_high_score, v_score),
          easy_nine_count = t.easy_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  elsif p_difficulty = 'MEDIUM' then
    update public.anagram_quest_stats t
      set medium_high_score = greatest(t.medium_high_score, v_score),
          medium_nine_count = t.medium_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  else
    update public.anagram_quest_stats t
      set hard_high_score = greatest(t.hard_high_score, v_score),
          hard_nine_count = t.hard_nine_count + v_nine,
          hard_final_round_solved = t.hard_final_round_solved or p_final_round_solved,
          updated_at = now()
      where t.user_id = v_uid;
  end if;

  -- final_rounds_solved and perfect_game_achieved are difficulty-agnostic
  -- (a Round 5 solve or a flawless game counts on any difficulty), so
  -- these two run unconditionally alongside whichever branch above fired.
  update public.anagram_quest_stats t
    set final_rounds_solved = t.final_rounds_solved + (case when p_final_round_solved then 1 else 0 end),
        perfect_game_achieved = t.perfect_game_achieved or v_perfect,
        updated_at = now()
    where t.user_id = v_uid;

  return query
    select gs.easy_high_score, gs.medium_high_score, gs.hard_high_score,
           gs.easy_nine_count, gs.medium_nine_count, gs.hard_nine_count,
           gs.final_rounds_solved, gs.hard_final_round_solved, gs.perfect_game_achieved
    from public.anagram_quest_stats gs
    where gs.user_id = v_uid;
end;
$$;
grant execute on function public.record_anagram_quest_difficulty_result(text, int, int, boolean, int[]) to authenticated;

-- ---- 3. widen requirement_type + achievement_requirement_met() ----
alter table public.achievements drop constraint if exists achievements_requirement_type_check;
alter table public.achievements
  add constraint achievements_requirement_type_check
  check (requirement_type is null or requirement_type in (
    'total_level', 'game_xp', 'game_level',        -- pre-existing
    'games_played', 'high_score',                  -- pre-existing
    'anagram_final_rounds',                         -- new: anagram_quest_stats.final_rounds_solved
    'anagram_hard_high_score',                      -- new: anagram_quest_stats.hard_high_score
    'anagram_hard_final_round',                     -- new: anagram_quest_stats.hard_final_round_solved
    'anagram_perfect_game'                          -- new: anagram_quest_stats.perfect_game_achieved
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
  v_bool boolean;
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
  elsif a.requirement_type = 'anagram_final_rounds' then
    select final_rounds_solved into v_val from public.anagram_quest_stats where user_id = p_user;
    return coalesce(v_val, 0) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'anagram_hard_high_score' then
    select hard_high_score into v_val from public.anagram_quest_stats where user_id = p_user;
    return coalesce(v_val, 0) >= coalesce(a.requirement_value, 0);
  elsif a.requirement_type = 'anagram_hard_final_round' then
    select hard_final_round_solved into v_bool from public.anagram_quest_stats where user_id = p_user;
    return coalesce(v_bool, false);
  elsif a.requirement_type = 'anagram_perfect_game' then
    select perfect_game_achieved into v_bool from public.anagram_quest_stats where user_id = p_user;
    return coalesce(v_bool, false);
  end if;
  return true;
end;
$$;
revoke execute on function public.achievement_requirement_met(uuid, text) from public, anon, authenticated;

-- ---- 4. retire the old Anagram Quest achievement set ----
-- Deliberately a hard delete, not a rename-forward — the user explicitly
-- asked for the old set to be removed outright, not preserved under new
-- ids. unlocked_achievements/pinned_achievements rows for these ids are
-- cleaned up explicitly first (belt-and-suspenders — the FK's `on delete
-- cascade`/`on delete set null` would do this anyway the moment the
-- achievements rows below are deleted, but being explicit here makes the
-- data-loss visible in the migration itself rather than implicit in an FK
-- action). Any player who had earned e.g. "First Word" or "Score 30
-- Points" loses that specific unlock permanently — there is no equivalent
-- new id for several of these (First Word, First Game, Eight Great,
-- Nine Divine as literal ids all go away), so a preserving rename isn't
-- meaningfully possible for this set anyway.
delete from public.unlocked_achievements where achievement_id in (
  'anagram_first_word', 'anagram_first_game', 'anagram_first_7', 'anagram_first_8',
  'anagram_first_9', 'anagram_first_final', 'anagram_score_30', 'anagram_score_50',
  'anagram_play_10', 'intel_level_10', 'intel_level_25', 'intel_level_50'
);
delete from public.pinned_achievements where achievement_id in (
  'anagram_first_word', 'anagram_first_game', 'anagram_first_7', 'anagram_first_8',
  'anagram_first_9', 'anagram_first_final', 'anagram_score_30', 'anagram_score_50',
  'anagram_play_10', 'intel_level_10', 'intel_level_25', 'intel_level_50'
);
delete from public.achievements where achievement_id in (
  'anagram_first_word', 'anagram_first_game', 'anagram_first_7', 'anagram_first_8',
  'anagram_first_9', 'anagram_first_final', 'anagram_score_30', 'anagram_score_50',
  'anagram_play_10', 'intel_level_10', 'intel_level_25', 'intel_level_50'
);

-- ---- 5. the 20 new achievements ----
-- requirement_game_key = 'intelligence' for every stat pulled from
-- game_stats (games_played/high_score) — that table is keyed by the SKILL
-- a game trains, not the game's own slug (see the site-wide achievements
-- migration's comment on this). The 4 new anagram_* requirement types read
-- from anagram_quest_stats directly (single-row-per-user, no game_key
-- concept), so requirement_game_key is left null for those — harmless,
-- achievement_requirement_met() never reads it for those branches.
insert into public.achievements
  (achievement_id, name, description, icon, tier, sort_order, category, game_key, requirement_type, requirement_game_key, requirement_value)
values
  -- BRONZE
  ('anagram_initiate', 'Anagram Quest Initiate', 'Play 10 Anagram Quest games.', '🎮', 'bronze', 100, 'games', 'anagram-quest', 'games_played', 'intelligence', 10),
  ('anagram_seven_up', 'Seven Up', 'Find a 7-letter word.', '🔤', 'bronze', 110, 'games', 'anagram-quest', null, null, null),
  ('anagram_point_seeker', 'Point Seeker', 'Score 20+ points in one Anagram Quest game.', '🎯', 'bronze', 120, 'games', 'anagram-quest', 'high_score', 'intelligence', 20),

  -- SILVER
  ('anagram_adept', 'Anagram Quest Adept', 'Play 25 Anagram Quest games.', '📘', 'silver', 200, 'games', 'anagram-quest', 'games_played', 'intelligence', 25),
  ('anagram_octoword', 'Octoword', 'Find an 8-letter word.', '🔡', 'silver', 210, 'games', 'anagram-quest', null, null, null),
  ('anagram_point_breaker', 'Point Breaker', 'Score 30+ points in one Anagram Quest game.', '💥', 'silver', 220, 'games', 'anagram-quest', 'high_score', 'intelligence', 30),

  -- GOLD
  ('anagram_expert', 'Anagram Quest Expert', 'Play 50 Anagram Quest games.', '🥇', 'gold', 300, 'games', 'anagram-quest', 'games_played', 'intelligence', 50),
  ('anagram_nine_rack', 'Nine Rack', 'Find a 9-letter word during Rounds 1-4.', '9️⃣', 'gold', 310, 'games', 'anagram-quest', null, null, null),
  ('anagram_final_word', 'Final Word', 'Solve the Round 5 nine-letter anagram.', '🏁', 'gold', 320, 'games', 'anagram-quest', 'anagram_final_rounds', null, 1),
  ('anagram_point_master', 'Point Master', 'Score 50+ points in one Anagram Quest game.', '🌟', 'gold', 330, 'games', 'anagram-quest', 'high_score', 'intelligence', 50),

  -- PLATINUM
  ('anagram_veteran', 'Anagram Quest Veteran', 'Play 100 Anagram Quest games.', '🎖️', 'platinum', 400, 'games', 'anagram-quest', 'games_played', 'intelligence', 100),
  ('anagram_final_form', 'Final Form', 'Solve 5 Final Rounds.', '🔁', 'platinum', 410, 'games', 'anagram-quest', 'anagram_final_rounds', null, 5),
  ('anagram_against_the_clock', 'Against the Clock', 'Solve the Round 5 nine-letter word on Hard difficulty.', '⏱️', 'platinum', 420, 'games', 'anagram-quest', 'anagram_hard_final_round', null, 1),
  ('anagram_point_legend', 'Point Legend', 'Score 60+ points in one Anagram Quest game.', '💫', 'platinum', 430, 'games', 'anagram-quest', 'high_score', 'intelligence', 60),

  -- DIAMOND
  ('anagram_nine_letter_legend', 'Nine-Letter Legend', 'Solve the Round 5 nine-letter word 10 times.', '🧩', 'diamond', 500, 'games', 'anagram-quest', 'anagram_final_rounds', null, 10),
  ('anagram_five_for_five', 'Five for Five', 'Score points in every normal round and also solve the Final Round in the same game.', '🏅', 'diamond', 510, 'games', 'anagram-quest', 'anagram_perfect_game', null, 1),
  ('anagram_hard_hitter', 'Hard Hitter', 'Score 55+ points on Hard difficulty.', '🔥', 'diamond', 520, 'games', 'anagram-quest', 'anagram_hard_high_score', null, 55),
  ('anagram_point_emperor', 'Point Emperor', 'Score 70+ points in one Anagram Quest game.', '👑', 'diamond', 530, 'games', 'anagram-quest', 'high_score', 'intelligence', 70),

  -- MYTHIC
  ('anagram_god', 'Anagram God', 'Solve 25 Final Rounds.', '🐉', 'mythic', 600, 'games', 'anagram-quest', 'anagram_final_rounds', null, 25),
  ('anagram_point_god', 'Point God', 'Score 80+ points in one Anagram Quest game.', '⚡', 'mythic', 610, 'games', 'anagram-quest', 'high_score', 'intelligence', 80)
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
