-- ============================================================================
-- Avatar Rig — widen avatar_rig_items.scale's allowed range again, from
-- [0.05, 10] to [0.05, 20].
--
-- 20260919020000 already raised this once, from 5 to 10, when Green
-- Ornate Suit Top's full-canvas art needed a bigger multiplier than any
-- tightly-cropped item (Admin Crown, Doggy Slippers) ever had. Green
-- Ornate Shoes hits the same wall again, worse: its shoe graphic fills
-- only ~14% of its own 1024x1536 canvas width (Doggy Slippers' left
-- shoe fills ~91% of its own tight 350x350 crop), so matching a
-- similarly-visible on-body size needs scale ~11.4 for the left shoe —
-- already past the old ceiling of 10.
--
-- This whole "small graphic centred on a large, mostly-transparent
-- canvas" shape is the norm for this entire supplied-asset batch (suit
-- top, suit bottoms, tracksuit bottoms, now shoes), not a one-off, so
-- 20 gives real headroom against the next one instead of raising this
-- same constraint a third time.
-- ============================================================================

alter table public.avatar_rig_items drop constraint if exists avatar_rig_items_scale_check;
alter table public.avatar_rig_items add constraint avatar_rig_items_scale_check
  check (scale between 0.05 and 20);
