-- ============================================================================
-- Add Agility and Driving as real skills, alongside Intelligence.
-- ============================================================================
-- public.games is the ONE table that drives every skill-aware system on
-- the site (Skills page, Highscores, public player profiles, the admin
-- skill editor) — every one of those already reads game_key/name/
-- sort_order generically rather than hardcoding "intelligence", per
-- 20260905030000_only_intelligence_skill.sql's own header comment ("Add a
-- new row here the moment another skill is ready to go live"). So the
-- entire backend change is: add two rows here, and backfill
-- game_progress for every account that already exists (new signups
-- already get a row per public.games automatically, via handle_new_user()
-- — see 20260903004123_initial_schema.sql).
--
-- Neither skill has any XP source yet (no game awards Agility/Driving XP)
-- — that's deliberate, matching what was asked. They exist purely as
-- properly-tracked, independent skills starting at level 1 / 0 XP, same
-- as a brand-new account's Intelligence starts, ready for a future game
-- to award XP into them exactly like record_game_result()/award_xp()
-- already do for Intelligence.
--
-- Intelligence itself is completely untouched: no row changed, no XP/
-- level function edited, no existing player data modified.
-- ============================================================================

insert into public.games (game_key, name, sort_order) values
  ('agility', 'Agility', 2),
  ('driving', 'Driving', 3)
on conflict (game_key) do nothing;

-- Backfill game_progress for every account that already existed before
-- this migration — new signups already get this via handle_new_user()'s
-- own `insert into game_progress select ... from games`, but that trigger
-- only ever fires once, at signup time, for whatever rows existed in
-- public.games back then. `on conflict do nothing` makes this safe to
-- ever re-run and guarantees no existing Intelligence row is touched.
insert into public.game_progress (user_id, game_key, xp, level)
select p.id, g.game_key, 0, 1
from public.profiles p
cross join public.games g
where g.game_key in ('agility', 'driving')
on conflict (user_id, game_key) do nothing;
