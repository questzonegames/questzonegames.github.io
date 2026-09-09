-- ============================================================================
-- One-time backfill: an account that already had "Welcome to Your
-- Profile" unlocked (carried over from the old misc_first_login id by
-- the previous migration) never went through unlock_achievement()'s
-- reward-grant step — that only runs on a genuinely NEW unlock, and
-- theirs isn't new. Without this, only players who unlock it AFTER this
-- update ever receive Doggy Slippers, which isn't fair to someone who
-- rightfully already holds the achievement. Idempotent via inventory_
-- items' own primary key, same as the live reward-grant path — safe to
-- re-run.
-- ============================================================================
insert into public.inventory_items (user_id, item_id)
select ua.user_id, 'doggy-slippers'
from public.unlocked_achievements ua
where ua.achievement_id = 'welcome_to_your_profile'
on conflict (user_id, item_id) do nothing;
