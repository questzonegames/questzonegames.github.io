-- Intelligence is, for now, the only real, coded skill/game. Every other
-- public.games row (Space Snake included, plus the unused total-level-N
-- placeholders) is removed on purpose — game_progress and game_stats rows
-- for those keys cascade-delete automatically (their game_key FK is
-- `on delete cascade`), wiping any XP/high-score data tied to them; any
-- achievement whose requirement_game_key pointed at one of these keys has
-- that column set to null instead of blocking the delete (`on delete set
-- null`). Space Snake itself still plays fine — it just no longer trains a
-- skill or banks XP until it's reintroduced as a real games row.
delete from public.games where game_key <> 'intelligence';

-- normalize sort_order now that it's the only row (matches a fresh install
-- of supabase/schema.sql, which seeds just this one row at sort_order 1)
update public.games set sort_order = 1 where game_key = 'intelligence';
