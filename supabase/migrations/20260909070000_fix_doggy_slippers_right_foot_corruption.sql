-- Cleans up avatar_rig_items rows for Doggy Slippers' Right part that were
-- corrupted by a real admin-editor bug: avatar-viewer.js's loadRigData()
-- cached its Supabase fetch for the whole page lifetime and never
-- refreshed after a save, so switching Part in the Avatar Rig editor kept
-- reloading a stale, page-load-old snapshot instead of what had actually
-- just been saved — silently showing an already-saved calibration as
-- reverted to its default, right before the admin dragged it back into
-- place from that wrong starting point. Fixed properly in avatar-viewer.js
-- (loadRigData is now invalidated after every save) and admin-avatar-
-- rig.html (every save/reset path calls that invalidation) — this
-- migration only removes the bad data the bug produced before the fix:
--
--   - (male, boots, doggy-slippers, front, part=right): corrupted to
--     offset_x=-155, offset_y=-140, scale=1.75 (scale visibly leaked over
--     from the Left part's real, correct 1.75 — not a value the admin
--     ever actually set for Right) instead of the admin's real tuned
--     position. Deleted outright rather than guessed-restored, since the
--     admin's actual final intended position isn't recoverable from here —
--     they'll re-anchor Right from a clean slate now that the editor
--     correctly keeps what they save.
--   - (male, boots, doggy-slippers, {back,right,left}, part=right): three
--     rows at the literal built-in default (offset 0/0, scale 1, no
--     rotation) — created by "Save Item — All Directions" looping over
--     every camera pose even though Quest Zone is front-view-only today
--     (see docs/avatar-equipment.md) and only Front was ever actually
--     calibrated. Never rendered by anything live, but not real
--     calibration data either — removed as cleanup, not because they were
--     doing any harm.
--
-- Left's rows (front, part=left) are untouched — confirmed correct and
-- unaffected by this bug.
delete from public.avatar_rig_items
where body_type = 'male'
  and slot = 'boots'
  and item_id = 'doggy-slippers'
  and part = 'right';
