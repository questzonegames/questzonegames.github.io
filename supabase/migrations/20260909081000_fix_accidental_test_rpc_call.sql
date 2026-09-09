-- Corrects an accidental test call made against James's own real account
-- while implementing the Anagram Quest achievements v2 migration: a
-- verification call to record_anagram_quest_difficulty_result() was run
-- from a browser tab that turned out to still be signed in as James's real
-- account (session left over from earlier testing this same session), not
-- a test account. That call:
--   p_difficulty='HARD', p_score=60, p_nine_letter_count=1,
--   p_final_round_solved=true, p_round_scores=[10,10,10,10,30]
--
-- James's instruction on the two booleans (asked directly, since the RPC
-- only ever ORs them true and never clears them, so whether this call
-- actually changed anything is otherwise unknowable): unsure whether
-- either was legitimately already true, but "make sure nobody has this
-- achievement until they actually do it" — so both are force-set back to
-- false here, erring toward requiring a real future solve/perfect game
-- over risking a premature unlock.
--
--   - final_rounds_solved: the RPC does `+= 1` when p_final_round_solved
--     is true, so subtracting exactly 1 (floored at 0) exactly reverses
--     this one call, regardless of what the real prior value was.
--   - hard_final_round_solved, perfect_game_achieved: forced back to
--     false per the above.
--
-- Deliberately NOT touched (no safe way to know the real prior value, and
-- an uncorrected 5-15 point overshoot is low-impact — see the chat reply
-- for how to get these set exactly right if it matters):
--   - hard_high_score — greatest(prior, 60); if his real prior Hard best
--     was already >= 60, unaffected; if lower, it's now permanently (and
--     incorrectly) 60. Lowering it blindly risks erasing a real score
--     instead, which is the worse mistake of the two.
--   - hard_nine_count — incremented by 1 (p_nine_letter_count); same
--     "unknown real prior value" problem.
update public.anagram_quest_stats
set final_rounds_solved = greatest(0, final_rounds_solved - 1),
    hard_final_round_solved = false,
    perfect_game_achieved = false,
    updated_at = now()
where user_id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f';
