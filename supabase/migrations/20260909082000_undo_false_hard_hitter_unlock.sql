-- Follow-up to 20260909081000_fix_accidental_test_rpc_call.sql: the
-- inflated hard_high_score (60) left over from that accidental test call
-- crossed Hard Hitter's 55-point threshold the moment the achievements
-- page next ran checkStatAchievements() — which incorrectly, automatically
-- unlocked 'anagram_hard_hitter' on James's real account. Directly
-- violates his explicit instruction that nobody should have this
-- achievement until they've actually earned it.
--
-- Fix: delete the false unlock, and clamp hard_high_score down to 54 (one
-- point under the threshold) ONLY IF it's currently >= 55 — a temporary,
-- deliberately conservative placeholder until James confirms his real
-- Hard-difficulty high score, at which point it should be set to that
-- exact real number (this migration does not know it and does not guess
-- it — 54 is chosen only to guarantee the achievement cannot re-trigger
-- via checkStatAchievements() in the meantime, not as a claim about his
-- real score).
delete from public.unlocked_achievements
where user_id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f'
  and achievement_id = 'anagram_hard_hitter';

update public.anagram_quest_stats
set hard_high_score = 54,
    updated_at = now()
where user_id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f'
  and hard_high_score >= 55;
