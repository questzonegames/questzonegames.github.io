# Quest Zone — Avatar Rig (Admin Editor)

An internal, admin-only visual calibration tool for the 2D avatar equipment
system, at **Admin Zone → Avatar Rig** (`profile/admin-avatar-rig.html`).
It lets a trusted admin drag/nudge/scale/rotate an equipped item directly on
the avatar and save that placement — the REAL avatar every player sees reads
the exact same saved values, live, with no code change or deploy needed.

This doc explains the system this editor operates on. For the underlying
rig anchor measurements and the bald-base-is-the-reference philosophy, see
[docs/avatar-equipment.md](avatar-equipment.md) first — this doc assumes
you've read that one.

## One source of truth

Item placement used to be baked into a pre-rendered PNG per item per
direction (see avatar-equipment.md's "frame" pipeline) — correct, but
required regenerating an image file and a deploy for every pixel nudge.

Now it's **live, computed data**, stored in Supabase and read by
`assets/js/avatar-viewer.js` on every page that renders an avatar. The
Avatar Rig editor and the real game renderer both call the exact same
function — `window.QZAvatarViewer.computeItemLayout()` — so there is
architecturally no way for "what the admin sees in the editor" and "what a
player sees on their profile" to drift apart. A save in the editor is a
row in a table; the renderer reads that row.

The old pre-baked `frames`/`hairMasks` files (see avatar-equipment.md)
still exist and are still referenced in `assets/js/inventory-data.js` —
**only as an emergency fallback** if the live Supabase fetch fails outright
(offline dev, a real outage). In normal operation they are never used.

## Data model (Supabase)

`supabase/migrations/20260906010000_avatar_rig_editor.sql`:

- **`avatar_rig_anchors`** — the base rig: one row per
  `(body_type, direction, anchor_type)`. `anchor_type` is one of
  `above_head` / `skull` / `forehead` / `neck`. Columns: `canvas_w`,
  `canvas_h` (must match that direction's real `avatar-<dir>.png`
  dimensions), `center_x_pct`, `y_pct`, `width_pct` — all percentages of
  that direction's own base-art canvas, never of an on-screen container
  (see avatar-equipment.md for why container-relative percentages are
  fragile). Seeded from the values already measured off the bald base's
  alpha channel — see `assets/js/avatar-rig.js`.
- **`avatar_rig_items`** — one row per
  `(body_type, slot, item_id, direction)`: `anchor_type` (which anchor
  this item is measured from — an item-level *choice*, not fixed by the
  item's category), `offset_x`/`offset_y` (canvas-pixel nudges from that
  anchor's position), `scale` (multiplier on the anchor's own
  `width_pct` — `1.0` means "rendered width equals the anchor's reference
  width exactly"; a crown around `0.6`–`0.85` is typical), `rotation`
  (degrees).
- **`avatar_rig_audit_log`** — who changed what, when. Admin-readable only.

**Security**: both data tables are `RLS SELECT using (true)` — public read,
because the real renderer needs it for every visitor, not just admins —
and have **no insert/update/delete policy at all**. The only way to change
a row is through one of three `SECURITY DEFINER` RPCs, each starting with
`if not public.is_admin() then raise exception 'Not authorized.';` — the
same controlled-write-path pattern as every other admin action in this
project (`admin_ban_user`, `admin_grant_item`, etc — see SECURITY.md). A
normal user who deletes the Avatar Rig button from dev tools and calls
`admin_save_avatar_rig_item` directly gets `Not authorized.` from
Postgres, not a client-side check they could skip. Verified live this
session: a non-admin account's RPC call was rejected; a direct
(non-RPC) table `UPDATE` as `anon` silently affected zero rows (no
policy to match); absurd values (`scale = 9999`) are rejected by CHECK
constraints; `NaN`/`Infinity` are rejected for free by Postgres `numeric`,
which has no representation for either.

## The three RPCs

- `admin_save_avatar_rig_item(body_type, slot, item_id, direction, anchor_type, offset_x, offset_y, scale, rotation)` — upserts one direction's calibration for one item.
- `admin_reset_avatar_rig_item_to_factory(body_type, slot, item_id, direction default null)` — **deletes** the row(s), falling back to the built-in JS default (anchor `skull`, all zeros, scale `1`). `direction = null` resets all 4 at once. This is the strong "factory reset" — separate from "reset to last saved" (see below), which needs no server call at all.
- `admin_save_avatar_rig_anchor(body_type, direction, anchor_type, center_x_pct, y_pct, width_pct)` — RIG ANCHOR mode only: moves the underlying anchor itself, affecting every item that uses it. Deliberately a different function from the item save, so the two modes can never be confused.

## Using the editor

**Mode** (top of the page) — `ITEM` (default), `RIG ANCHOR`, `POSE`:

- **ITEM** — moves only the selected item's own calibration. Safe default.
- **RIG ANCHOR** — moves the underlying body anchor (e.g. `skull`) itself.
  Affects every item using that anchor. Pick the anchor type from its own
  dropdown (independent of which item you had selected in ITEM mode); the
  transform fields relabel to `Center X` / `Y Position` / `Reference
  Width`, all percentages of that direction's canvas.
- **POSE** — disabled, with an explanation. See "Current limitations" below.

**Selection panel** — Body (`Male` only today — see
avatar-equipment.md/`assets/js/avatar-viewer.js`'s `AVAILABLE_BASES` for
why Female isn't real yet; the data model is already body-type-keyed so
adding a `female` row set later needs zero editor changes) → Slot → Item
(only items that actually exist for that slot show up — most slots show
"no items in this slot yet" today, since Admin Crown is the only item with
real art) → Direction (Front/Right/Back/Left — switching never loses
unsaved work on another direction; each direction's edits are tracked
separately).

**Preview** — drag the item directly on the avatar (screen-space drag,
converted to canvas-pixel offset automatically, so it always feels 1:1
regardless of preview zoom/window size), or use the numeric fields / nudge
buttons on the right. "Show anchors" overlays coloured dots for
ABOVE_HEAD/SKULL/FOREHEAD/NECK; in RIG ANCHOR mode the active one is a
larger white-ringed marker you drag directly. "Show hair" previews Short
Spiky under the item (toggling it never changes the item's own
calibration — it's purely a clipping/mask preview). "Show debug values"
overlays live x/y/scale/rotation next to the item.

**Toolbar**:
- **Undo / Redo** — a real history stack (not capped at 1-2 steps), each
  drag or each committed numeric-field edit is exactly one entry (dragging
  doesn't spam per-pixel-move history), `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`
  work while the page has focus. A new edit after undoing clears the old
  redo tail, same as any editor.
- **Reset to Last Saved** — discards local unsaved edits for the current
  direction, restoring whatever was last actually fetched from the DB. No
  server call.
- **Reset to Factory Default** — calls
  `admin_reset_avatar_rig_item_to_factory` (confirmation required) —
  deletes the saved row outright.
- **Save Front/Right/Back/Left** (label follows the selected direction) —
  saves only that one direction.
- **Save Item — All Directions** — saves all 4 directions for the current
  item in one pass.
- **Save Whole Rig** — saves every direction with unsaved changes right
  now (could span the item you're looking at only, since only one item
  exists today — architected to span multiple pending items once more
  exist). Shows a confirmation naming exactly how many changes it's about
  to save first.
- The **unsaved-changes dot** and a **dirty dot on each direction button**
  make it obvious what hasn't been saved; leaving the page with unsaved
  changes triggers the browser's native "leave site?" prompt.

## Adding a future item through this editor (no code change)

1. Add the item's 4 directional `views` PNGs + a catalog entry in
   `assets/js/inventory-data.js` (slot, name, icon — `anchorType` is only
   an offline-fallback default, see below).
2. Open Admin Zone → Avatar Rig → pick the slot → the new item appears in
   the Item dropdown automatically (it's just `QZ_ITEM_CATALOG` filtered
   by slot).
3. Drag it into place on Front, Save Front. Repeat Right/Back/Left, or use
   Save Item — All Directions once every view looks right.
4. Done — every player immediately sees it correctly placed, no deploy.

If it needs hair to be masked out from underneath it (a hat, not a small
pin), set `hairBehavior: 'partial'` and `hidesHair`/`'full'` as documented
in avatar-equipment.md — the occlusion mask is generated **live** from
wherever you just calibrated the item (see `buildHairMaskDataUrl` in
`assets/js/avatar-viewer.js`), so it can never point at a stale position
after a recalibration.

## Current limitations (not faked)

- **POSE mode is a placeholder.** The base avatar art
  (`avatar-<dir>.png`) is one flattened image per direction — there is no
  separate upper-arm/forearm/hand layer to rotate independently. Building
  STAFF/SHIELD/TWO_HANDED poses needs new, separated transparent PNGs
  first. Exact list (per direction — 28 files total for all 4 directions):
  ```
  <dir>_torso.png              (transparent where arms attach)
  <dir>_left_upper_arm.png
  <dir>_left_forearm.png
  <dir>_left_hand.png
  <dir>_right_upper_arm.png
  <dir>_right_forearm.png
  <dir>_right_hand.png
  ```
  same canvas dimensions as that direction's current base image,
  transparent background, slight overlap at shoulder/elbow/wrist joints so
  no gap shows mid-rotation. Once these exist, the pose editor can bend an
  arm the same way this editor already moves a crown — by computing a
  transform and applying it live, no pre-rendered pose images needed.
- **Only Male / only Head-with-an-item exist right now.** The data model,
  UI, and security are all slot/body-type-generic already (necklace, body,
  legs, boots, gloves, back, mainHand, offHand, accessory all show up in
  the selectors) — there's simply nothing in `QZ_ITEM_CATALOG` for those
  slots yet, and no `female` rows in `avatar_rig_anchors`. Adding either
  needs new art + catalog entries, not editor changes.
- **FOREHEAD/NECK anchors are approximate** (see avatar-equipment.md) —
  fine since nothing uses them yet; recalibrate properly (in RIG ANCHOR
  mode, live, visually) the first time a real forehead/neck item exists.

## Files

- `supabase/migrations/20260906010000_avatar_rig_editor.sql` — schema, RLS, RPCs, seed data
- `assets/js/avatar-viewer.js` — live rendering (`computeItemLayout`, `loadRigData`, `buildHairMaskDataUrl`) shared with the editor
- `profile/admin-avatar-rig.html` — the editor itself
- `profile/index.html` — the "Avatar Rig" tile (admin-only, own-profile-only — see `showAdminAvatarRigTile`)
- `assets/js/inventory-data.js` — `anchorType` per item (offline-fallback default only)
