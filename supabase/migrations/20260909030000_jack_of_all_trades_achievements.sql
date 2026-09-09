-- ============================================================================
-- "Jack of All Trades" Total Level achievement family
-- ============================================================================
-- Six standalone, permanent, cumulative achievements — one per tier — that
-- unlock off the account's real Total Level (public.total_level(), the
-- exact function achievement_requirement_met()'s existing 'total_level'
-- branch already verifies against — nothing new needed there). Reaching a
-- higher threshold does NOT replace/remove an earlier tier: each tier is
-- its own row in public.achievements with its own achievement_id, so all
-- six can be independently unlocked (and independently pinned) at once,
-- exactly like every other achievement family already works.
--
-- Retroactive + live unlocking both fall out of the existing generic
-- machinery for free — no new code path needed:
--   - window.QZAchievements.checkStatAchievements() (assets/js/qz-
--     achievements.js) already re-checks EVERY achievement row with a
--     non-null requirement_type against the account's real stats, and is
--     already called on profile/achievements.html load and after every
--     completed Anagram Quest game (games/anagram-quest/anagram-quest.js,
--     right after award_xp() runs) — so as soon as these six rows exist,
--     existing players get retroactively caught up the next time either
--     of those runs, and new players get checked live the moment their
--     Total Level next changes. Nothing here is a "fake counter" — it's
--     the same public.total_level() the Total Level stat everywhere else
--     on the site already reads.
--
-- icon_locked (new column) lets a catalog row supply a distinct locked-
-- state badge image, used instead of the generic lock overlay the icon
-- box otherwise draws over an emoji icon — see pickIcon()/isImageIcon()
-- in qz-achievements.js and their call sites in profile/achievements.html,
-- assets/js/achievement-inspection.js. Every pre-existing achievement's
-- icon is a plain emoji and leaves this null, so their locked-state
-- rendering is completely unchanged.
-- ============================================================================

alter table public.achievements add column if not exists icon_locked text;

insert into public.achievements
  (achievement_id, name, description, icon, icon_locked, tier, sort_order, category, game_key, requirement_type, requirement_game_key, requirement_value)
values
  ('jack_of_all_trades_bronze',   'Jack of All Trades — Bronze',   'Reach a Total Level of 25.',  '../assets/img/achievements/badges/jack-of-all-trades-bronze.png',   '../assets/img/achievements/badges/jack-of-all-trades-locked.png', 'bronze',   400, 'levels', null, 'total_level', null, 25),
  ('jack_of_all_trades_silver',   'Jack of All Trades — Silver',   'Reach a Total Level of 50.',  '../assets/img/achievements/badges/jack-of-all-trades-silver.png',   '../assets/img/achievements/badges/jack-of-all-trades-locked.png', 'silver',   410, 'levels', null, 'total_level', null, 50),
  ('jack_of_all_trades_gold',     'Jack of All Trades — Gold',     'Reach a Total Level of 100.', '../assets/img/achievements/badges/jack-of-all-trades-gold.png',     '../assets/img/achievements/badges/jack-of-all-trades-locked.png', 'gold',     420, 'levels', null, 'total_level', null, 100),
  ('jack_of_all_trades_platinum', 'Jack of All Trades — Platinum', 'Reach a Total Level of 150.', '../assets/img/achievements/badges/jack-of-all-trades-platinum.png', '../assets/img/achievements/badges/jack-of-all-trades-locked.png', 'platinum', 430, 'levels', null, 'total_level', null, 150),
  ('jack_of_all_trades_diamond',  'Jack of All Trades — Diamond',  'Reach a Total Level of 250.', '../assets/img/achievements/badges/jack-of-all-trades-diamond.png',  '../assets/img/achievements/badges/jack-of-all-trades-locked.png', 'diamond',  440, 'levels', null, 'total_level', null, 250),
  ('jack_of_all_trades_mythic',   'Jack of All Trades — Mythic',   'Reach a Total Level of 500.', '../assets/img/achievements/badges/jack-of-all-trades-mythic.png',   '../assets/img/achievements/badges/jack-of-all-trades-locked.png', 'mythic',   450, 'levels', null, 'total_level', null, 500)
on conflict (achievement_id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  icon_locked = excluded.icon_locked,
  tier = excluded.tier,
  sort_order = excluded.sort_order,
  category = excluded.category,
  game_key = excluded.game_key,
  requirement_type = excluded.requirement_type,
  requirement_game_key = excluded.requirement_game_key,
  requirement_value = excluded.requirement_value;
