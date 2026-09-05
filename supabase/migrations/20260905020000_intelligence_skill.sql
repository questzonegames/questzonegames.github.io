-- ============================================================================
-- Rename the Anagram Quest game slot's skill to "Intelligence"
-- ============================================================================
-- Total Level Game slots are skills (like OSRS's Woodcutting/Fishing) —
-- the actual game (Anagram Quest, at games/anagram-quest/) trains this
-- skill rather than being a skill unto itself. Renaming game_key cascades
-- through game_progress AND game_stats (both reference public.games via
-- on-update-cascade foreign keys), so every account's existing level/xp/
-- high-score/games-played rows follow automatically — nothing orphaned,
-- no per-account backfill needed.
update public.games
   set game_key = 'intelligence', name = 'Intelligence'
 where game_key = 'anagram-quest';
