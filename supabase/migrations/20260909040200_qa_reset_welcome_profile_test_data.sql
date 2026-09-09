-- ============================================================================
-- QA-only: reset the "Welcome to Your Profile" achievement + Doggy
-- Slippers ownership for local testing of the fresh-unlock flow (the
-- earlier migrations' rename/backfill correctly carried these over for
-- existing accounts, which meant no account was left in a "never
-- unlocked" state to test the trigger itself against). Not a schema
-- change — safe no-op on any environment where nobody has unlocked it.
-- ============================================================================
delete from public.unlocked_achievements where achievement_id = 'welcome_to_your_profile';
delete from public.inventory_items where item_id = 'doggy-slippers';
delete from public.equipped_items where item_id = 'doggy-slippers';
