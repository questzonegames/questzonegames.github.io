# Quest Zone — Avatar Equipment System

How the 2D avatar rig works, what's calibrated, and how to add a new item.
Written after the Sep 2026 rig audit that recalibrated the Admin Crown from
the bald base's own measured geometry instead of the old, wrong, guessed
position — read that section first if you're fixing another misaligned item.

## The avatar is 4 flat directional images, not a 3D model

`assets/js/avatar-viewer.js` crossfades between four real renders
(front/right/back/left) of the character. There is no 3D rig, no skeleton,
no bones — every layer (base body, hair, equipped item) is its own set of 4
PNGs, all sharing the exact same **content-box** inside `.avatar-sprite`
(`position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
padding:9% 11% 5%`). Because every layer uses that identical box, a PNG
sized to the base body's own canvas dimensions for a given direction will
always land in exactly the same place the base body does, on any page,
regardless of that page's own avatar container size/aspect-ratio — this is
why the equip system prefers **full-canvas "frame" images** (see below)
over percentage-of-container positioning: percentages depend on the
container's own aspect ratio (which axis of `object-fit:contain` ends up
the constraint changes with it), full-canvas frames don't.

## The bald base is the master reference

`assets/img/avatar/avatar-<dir>.png` (the default "male-normal" body) and
`assets/img/avatar/male-{black,pale,dark-tanned}-<dir>.png` (the newer
skin-tone bodies, genuinely bald with a visible face) all share the
**same silhouette geometry** — confirmed by alpha-channel measurement, not
assumed. `male-normal` has hair rendered baked into its texture (it predates
the separate hair-layer system) but its head *shape* is pixel-identical to
the true bald bodies, so calibrating against either gives the same anchors.

Per-direction base canvas sizes (used as the coordinate space for every
anchor below):

| direction | canvas size |
|---|---|
| front | 636 × 1514 |
| back  | 584 × 1514 |
| right | 302 × 1515 |
| left  | 302 × 1515 |

(front/back share height 1514; right/left are 1515 — a 1px difference,
confirmed negligible, not worth re-exporting art over.)

## Head anchors — `assets/js/avatar-rig.js`

The **only** place head-attachment coordinates live. Measured by scanning
the bald base's own alpha channel per direction (row-by-row opaque-pixel
min/max, the browser's own canvas `getImageData`, not eyeballed) to find:

- **ABOVE_HEAD** — just above the very top of the skull silhouette (halos,
  floating icons — nothing built yet uses this)
- **SKULL** — the mid-cranium plateau, roughly brow/temple height. **This
  is where a crown/cap/helmet's band actually rests** — not the ear line,
  not the very top of the head. Getting this row wrong (using the ear-line
  instead) is exactly what made the Admin Crown look like it was cutting
  through the character's eyes before this recalibration.
- **FOREHEAD** — close to SKULL; an approximation, since silhouette alpha
  analysis can only find shape edges, not an internal feature like an
  eye-line. Recalibrate this properly the first time something actually
  needs it (a tiara, goggles).
- **NECK** — where the head silhouette narrows into the neck; for a
  collar/necklace anchor, not yet used by anything.

Anchors are stored as **percentages of that direction's own base canvas**,
never of the container — see the content-box math above for why.

Generic anchor types, not item-specific ones (an item never invents its own
anchor — see FINAL GOAL of the original rig directive):

```
Crown        -> SKULL
Baseball cap -> SKULL
Face mask    -> FACE (not yet defined — add when first needed)
Tiara        -> FOREHEAD
Halo         -> ABOVE_HEAD
Helmet       -> FULL_HEAD (hairBehavior:'full', no anchor collision to worry about)
```

## Debug calibration tool — `dev/avatar-rig-debug.html`

Open it locally (not linked from site nav, not for players). Overlays
colour-coded markers for every `HEAD_ANCHORS` point on the real bald base,
per direction, computed live from `avatar-rig.js` — if a marker looks wrong
there, the *data* is wrong, not the page. Also lets you pick any head-slot
catalog item and toggle hair on/off, to preview a real equip combination
before generating final frame art.

## How a head item actually gets its pixels: the frame + mask pipeline

An item's `views` (small, tightly-cropped per-direction art, e.g.
`admin-crown-front.png`, 129×122) is composited **once**, offline, onto a
blank canvas matching that direction's base-body canvas exactly, at a
position/scale derived from the SKULL anchor — producing the `frames`
images (`admin-crown-front-frame.png` etc, 636×1514, matching the base
body 1:1). `avatar-viewer.js` renders whichever exists (`frames` preferred,
`views`+percentage as an older fallback for non-full-canvas slots) through
the identical `.avatar-sprite` box the base body uses.

This compositing is done with plain **PowerShell + `System.Drawing`**
(`Add-Type -AssemblyName System.Drawing`) — no Node/Python available in
this environment, and browser-canvas-to-file round-tripping isn't
practical for anything but a one-off pixel measurement. The script used to
regenerate the Admin Crown lives in the session's scratchpad (not part of
the repo); the recipe is:

1. Load the base bald canvas's known `(canvasW, canvasH)` for that direction.
2. Pick a target crown width = a fraction of the SKULL-band width at that
   anchor. Went through two corrections to land here: the first attempt
   (≈0.91× the plateau width) put the crown's band at eye-level instead of
   brow-level (**width ratio alone doesn't fix vertical position** — get
   `bottomY` right first with a visual check, THEN tune width); the second
   attempt fixed the vertical position but was too narrow (≈0.65×,
   leaving a visible gap of bare scalp before the crown reached the
   ears/temples in every direction). The width that actually looks right,
   after a real visual check on all 4 directions with and without hair:
   **≈0.83× the mid-cranium plateau width** (front/back), or ≈0.62× the
   side-view depth width (right/left — a different, wider reference band
   for a profile silhouette, so not directly comparable to the front/back
   ratio).
3. Scale the item's own view image to that width (preserving its aspect
   ratio), place its **bottom edge** at the SKULL anchor's Y, horizontally
   centred on the anchor's X.
4. `Graphics.DrawImage` onto a blank transparent `Bitmap`, save as the new
   `frames/<item>-<dir>-frame.png`.
5. Regenerate that item's hair-occlusion mask as the **exact inverse alpha**
   of the new frame (crown opaque → mask alpha 0 there; everywhere else →
   mask alpha 255) via `LockBits`/`Marshal.Copy` bulk byte access — never
   `GetPixel`/`SetPixel` per-pixel, which is far too slow over a
   ~1-megapixel canvas.
6. **Always visually check the result** (the debug tool, or a throwaway
   test page) before trusting the numbers — the first attempt's numbers
   were internally consistent and still wrong, because "consistent" isn't
   the same as "anatomically correct." Only an actual look at the
   rendered head catches "crown crossing the eyes."

## Hair + headwear occlusion

`item.hairBehavior`: `'none'` (default, doesn't touch hair) / `'partial'`
(hair shows except where `item.hairMasks[direction]` says it's physically
covered — a real CSS alpha mask, `mask-mode:alpha`, generated per step 5
above) / `'full'` (hides the whole hairstyle outright — a helmet/hood).
`hidesHair:true` is an older spelling of `'full'`, still honoured.

The mask is generated from the **new** frame, every time the frame changes
— an item's mask must never be left pointing at where the item *used to*
sit.

## What's still using the old percentage system

Any head item without `frames` (only `views`) still positions via
`EQUIP_POSITIONS`/`EQUIP_BODY_CENTER_PCT` in `avatar-viewer.js` — the
percentage-of-container approach this doc's first section explains is
fragile across different page layouts. Nothing head-slot currently ships
this way; keep new head items on the frame pipeline.

## Adding a new SKULL-anchored item (e.g. a Santa Hat)

1. Get 4 directional views (front/right/back/left), transparent background,
   tightly cropped — same convention as `admin-crown-<dir>.png`.
2. Open `dev/avatar-rig-debug.html`, pick a rough target width (≈0.6-0.7×
   the SKULL-band width is a reasonable starting guess, per the crown's
   corrected numbers) and bottom-Y = the SKULL anchor's Y.
3. Composite with the same PowerShell/System.Drawing recipe above, save as
   `frames/santa-hat-<dir>-frame.png`.
4. Generate the matching hair mask (inverse alpha of the new frame) if the
   hat should show `partial` hair occlusion; skip masks entirely for
   `full` (a hat/helmet that encloses the whole head).
5. Add the catalog entry in `assets/js/inventory-data.js`:
   `anchorType` isn't a literal field read by the renderer today — record
   it in a comment for now — set `hairBehavior`, `hairMasks`, `frames`,
   `views`.
6. **Look at it** on all 4 directions (and with hair, if `partial`) before
   calling it done.

## Adding a FOREHEAD/FACE/ABOVE_HEAD item

Same pipeline, different anchor row from `avatar-rig.js`. FOREHEAD and FACE
are currently approximate (see above) — the first real item using one of
these should recalibrate that anchor properly (find the actual brow/eye
row by colour, not alpha silhouette) rather than trusting the placeholder
percentage.

## What is NOT built yet, and why (read before promising a feature)

The base body art (`avatar-<dir>.png` etc) is **one single flattened image
per direction** — there is no separate upper-arm/forearm/hand layer, no
separate torso/leg layer. This blocks, entirely, until new art exists:

- **Articulated arm rig / pose system** (DEFAULT, STAFF, SHIELD,
  TWO_HANDED, HEAVY poses) — bending an elbow or raising a forearm needs
  that limb to be its own transparent PNG piece with its own pivot; you
  cannot rotate part of a flat image without literally cutting it apart.
- **Clothing that follows an arm pose** (sleeves bending with a raised
  arm) — same blocker, one level up.
- **Per-garment occlusion** (a trench coat hiding only the trouser pixels
  it physically covers) — needs either separated body-part layers or a
  hand-authored mask per garment; neither exists for any clothing item
  today (there is currently exactly one non-base item in the whole
  catalog — the Admin Crown).

None of this was faked. See the FILES CHANGED / ASSETS I STILL NEED report
for the exact list of new transparent PNGs required to unblock the arm rig,
if/when that's the next priority.
