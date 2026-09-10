-- Point God (Mythic, Anagram Quest): lower the threshold from 80+ points
-- to 75+ points — 80 was too harsh. Only requirement_value and the
-- description text change; everything else (tier, icon, sort_order,
-- requirement_type='high_score' against game_stats.high_score for the
-- 'intelligence' skill) is untouched, and nothing in the client needs to
-- change since the threshold is read entirely from this row.
update public.achievements
set description = 'Score 75+ points in one Anagram Quest game.',
    requirement_value = 75
where achievement_id = 'anagram_point_god';
