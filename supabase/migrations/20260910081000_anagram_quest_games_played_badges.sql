-- Real tier badge art for the 4 Anagram Quest games-played achievements —
-- same system as Jack of All Trades (see 20260909030000_jack_of_all_
-- trades_achievements.sql): just an icon/icon_locked UPDATE on existing
-- rows, no code changes anywhere. Every place that renders an achievement
-- badge (the grid card's top-left icon box, a pinned achievement slot,
-- the inspection popover) already goes through pickIcon()/isImageIcon()
-- in assets/js/qz-achievements.js, which treats ANY icon value ending in
-- an image extension as real badge art instead of an emoji glyph — so
-- setting these 4 values is the entire implementation.
update public.achievements set
  icon = '../assets/img/achievements/badges/anagram-quest-games-played-bronze.png',
  icon_locked = '../assets/img/achievements/badges/anagram-quest-games-played-locked.png'
where achievement_id = 'anagram_initiate';

update public.achievements set
  icon = '../assets/img/achievements/badges/anagram-quest-games-played-silver.png',
  icon_locked = '../assets/img/achievements/badges/anagram-quest-games-played-locked.png'
where achievement_id = 'anagram_adept';

update public.achievements set
  icon = '../assets/img/achievements/badges/anagram-quest-games-played-gold.png',
  icon_locked = '../assets/img/achievements/badges/anagram-quest-games-played-locked.png'
where achievement_id = 'anagram_expert';

update public.achievements set
  icon = '../assets/img/achievements/badges/anagram-quest-games-played-platinum.png',
  icon_locked = '../assets/img/achievements/badges/anagram-quest-games-played-locked.png'
where achievement_id = 'anagram_veteran';
