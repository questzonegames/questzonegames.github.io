-- ============================================================================
-- The site's original default character (assets/img/avatar/avatar-*.png)
-- is a male skin tone called "normal" now, not a generic "default" — see
-- assets/js/character-data.js / avatar-viewer.js for why (a "default" key
-- was accidentally shared between genders and could resolve to the male
-- body under a Female label). New signups should get the correct key from
-- day one; existing rows were already backfilled by hand.
-- ============================================================================

alter table public.avatar_customization
  alter column skin_colour set default 'normal';
