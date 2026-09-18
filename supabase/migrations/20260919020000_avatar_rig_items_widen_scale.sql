-- ============================================================================
-- Avatar Rig — widen avatar_rig_items.scale's allowed range from
-- [0.05, 5] to [0.05, 10].
--
-- Every item calibrated so far (Admin Crown, Doggy Slippers) is a tight
-- crop around just the garment/accessory, so a scale under 5 was always
-- enough to blow it up to the right on-body size relative to its anchor
-- width. The White T-shirt's supplied art is a much larger canvas
-- relative to its own garment silhouette, so calibrating it in the
-- Avatar Rig editor needs a scale above 5 — Save Whole Rig was failing
-- with "violates check constraint avatar_rig_items_scale_check" because
-- the old ceiling of 5 rejected the row outright. 10 gives real headroom
-- for future large-canvas items without opening the field up unbounded.
-- ============================================================================

alter table public.avatar_rig_items drop constraint if exists avatar_rig_items_scale_check;
alter table public.avatar_rig_items add constraint avatar_rig_items_scale_check
  check (scale between 0.05 and 10);
