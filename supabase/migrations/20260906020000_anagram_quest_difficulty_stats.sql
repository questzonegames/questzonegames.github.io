-- ============================================================================
-- Anagram Quest — per-difficulty high scores + 9-letter-word counters
-- ============================================================================
-- Anagram Quest now has EASY/MEDIUM/HARD difficulties (see DIFFICULTIES in
-- games/anagram-quest/anagram-quest.js). public.game_stats already tracks
-- ONE high_score/games_played pair per (user, game_key) — shared across
-- every difficulty, and generic across every game on the site (Space
-- Snake included). This migration adds a SECOND, Anagram-Quest-specific
-- table for the two things that only make sense broken down by
-- difficulty: a high score per difficulty, and a running count of how
-- many 9-letter words the player has ever correctly solved on that
-- difficulty (Rounds 1-4's bonus-tier 9-letter word, or Round 5's
-- 9-letter solve — both count identically). game_stats itself is
-- untouched; nothing about it changes shape.
-- ============================================================================

create table if not exists public.anagram_quest_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  easy_high_score int not null default 0,
  medium_high_score int not null default 0,
  hard_high_score int not null default 0,
  easy_nine_count int not null default 0,
  medium_nine_count int not null default 0,
  hard_nine_count int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.anagram_quest_stats enable row level security;

-- Personal stats, not a leaderboard — own row or admin only (matching
-- game_stats' own policy exactly; NOT public-select, unlike the avatar
-- rig tables, since there is no "every visitor needs to read everyone
-- else's" reason here).
drop policy if exists "anagram_quest_stats_select_own_or_admin" on public.anagram_quest_stats;
create policy "anagram_quest_stats_select_own_or_admin"
  on public.anagram_quest_stats for select
  using (auth.uid() = user_id or public.is_admin());

-- Deliberately no insert/update/delete policy for clients — same
-- controlled-write-path convention as every other stats table in this
-- schema: the only way this table changes is the RPC below, so nobody
-- can PATCH their own high score or 9-letter count via the REST API
-- directly.

-- ----------------------------------------------------------------------------
-- record_anagram_quest_difficulty_result() — the ONLY way this table
-- changes. Called once per completed game, alongside (not instead of)
-- the existing record_game_result()/award_xp() calls — this just adds
-- the difficulty-scoped breakdown those two don't track. p_score and
-- p_nine_letter_count are both clamped to sane per-game ranges so a
-- tampered client can't write an absurd value in: a single Anagram
-- Quest game has at most 5 rounds, so p_nine_letter_count can never
-- legitimately exceed 5, and p_score follows the same 0-100000 backstop
-- record_game_result() already uses.
-- ----------------------------------------------------------------------------
create or replace function public.record_anagram_quest_difficulty_result(
  p_difficulty text,
  p_score int,
  p_nine_letter_count int
)
returns table (
  easy_high_score int, medium_high_score int, hard_high_score int,
  easy_nine_count int, medium_nine_count int, hard_nine_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := greatest(0, least(coalesce(p_score, 0), 100000));
  v_nine int := greatest(0, least(coalesce(p_nine_letter_count, 0), 5));
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
    update public.anagram_quest_stats
      set easy_high_score = greatest(easy_high_score, v_score),
          easy_nine_count = easy_nine_count + v_nine,
          updated_at = now()
      where user_id = v_uid;
  elsif p_difficulty = 'MEDIUM' then
    update public.anagram_quest_stats
      set medium_high_score = greatest(medium_high_score, v_score),
          medium_nine_count = medium_nine_count + v_nine,
          updated_at = now()
      where user_id = v_uid;
  else
    update public.anagram_quest_stats
      set hard_high_score = greatest(hard_high_score, v_score),
          hard_nine_count = hard_nine_count + v_nine,
          updated_at = now()
      where user_id = v_uid;
  end if;

  return query
    select gs.easy_high_score, gs.medium_high_score, gs.hard_high_score,
           gs.easy_nine_count, gs.medium_nine_count, gs.hard_nine_count
    from public.anagram_quest_stats gs
    where gs.user_id = v_uid;
end;
$$;

grant execute on function public.record_anagram_quest_difficulty_result(text, int, int) to authenticated;
