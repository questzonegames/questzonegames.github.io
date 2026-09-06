// ===== Quest Zone — Profile avatar viewer =====
//
// A sprite-based pseudo-3D viewer: it crossfades between four real
// renders of the player's avatar (front / right / back / left) as it
// turns, rather than rendering an approximated 3D model. This is a
// deliberate choice — the four supplied images ARE the avatar's source of
// truth, so showing them directly (with a smooth dissolve between
// neighbours) always looks exactly like the avatar, at every angle,
// instead of risking a crude geometric stand-in.
//
// Behaviour: the avatar rests on one of 4 poses (front/right/back/left,
// clockwise) and holds it for ~5s before smoothly turning to the next.
// Any manual input (drag, or the left/right arrows) instantly takes over
// — it cancels whatever's mid-flight from wherever it visually is, settles
// on the nearest/target pose, and restarts the 5s hold from there. There
// is exactly one state machine (`phase`) driving this, so auto-advance,
// transitions and dragging can never fight each other or stack timers.
//
//   window.QZAvatarViewer.mount(container, opts)
//     -> { destroy, setAvatarEquipment, next, prev }
//
// container is the element the avatar fills (e.g. #avatar-3d) — it should
// be position:relative/absolute with a defined size; this module only
// ever touches elements it creates inside that container.
//
// opts.basePathPrefix (optional, default '') — every art path here (base
// body, hair, and an item's own frames/views/hairMasks from the catalog in
// inventory-data.js) is written relative to a page one directory below the
// site root (profile/index.html, profile/skills.html). A page nested one
// level deeper (e.g. games/anagram-quest/index.html) mounts the exact same
// avatar by passing basePathPrefix: '../' — prepended verbatim to every one
// of those relative paths — rather than needing its own copy of any of this.
//
// opts.staticFront (optional, default false) — mounts a permanently-front-
// facing, non-interactive render (no auto-rotation, no drag) instead of the
// full turntable viewer. Same renderer/state/equipment data either way;
// intended for small decorative slots (e.g. a lobby avatar circle) where a
// rotating/draggable avatar wouldn't make sense.
//
// ---- live, admin-calibrated equipment placement ----
// Equipment placement is no longer baked into a pre-rendered PNG per item.
// It reads live from Supabase (avatar_rig_anchors + avatar_rig_items — see
// supabase/migrations/20260906010000_avatar_rig_editor.sql), computed by
// computeItemLayout() below, which is ALSO the exact function the Admin
// Zone's Avatar Rig editor uses to preview/drag an item — one formula, one
// source of truth, so a value an admin saves there is what every player
// sees here, immediately, with no rebuild step. See docs/AVATAR_RIG.md.
//
// window.QZAvatarViewer also exports the pieces the editor needs directly:
//   loadRigData(client)              -> {anchors, items} (cached, shared)
//   computeContentBox(container, refImg)
//   computeRenderedImageRect(contentBox, naturalW, naturalH)
//   computeItemLayout(renderedRect, canvasW, canvasH, anchor, calib, itemNaturalW, itemNaturalH)
//   buildHairMaskDataUrl(canvasW, canvasH, itemImg, itemRectCanvasSpace, rotationDeg)
(function () {
  const HOLD_MS = 5000;         // how long a settled pose stays put
  const TRANSITION_MS = 450;    // smooth turn between adjacent poses
  const DRAG_DEG_PER_PX = 0.5;  // manual-drag sensitivity
  const CROSSFADE_HOLD = 0.35;  // fraction of a 90° sweep spent fully on one frame

  // clockwise pose order: Front -> Right -> Back -> Left -> Front
  const POSES = ['front', 'right', 'back', 'left'];
  const BASE_DIR = '../assets/img/avatar/';

  // Real (gender, skinColour) body art that actually exists as files today
  // — see assets/js/character-data.js for the matching options list a
  // Customise screen offers. 'male-normal' is deliberately handled
  // separately below: it's the site's original default character
  // (avatar-*.png, predating skin tones entirely), always male-presenting,
  // so it must never be what an unavailable FEMALE combo silently falls
  // back to — that exact mistake once shipped (a "Female" selection with
  // no real art rendered this male body under the Female label). Female
  // has zero entries in AVAILABLE_BASES on purpose; character-data.js's
  // empty female skinColours list is what makes profile/customise.html
  // disable the Female button entirely until real art exists, so this
  // fallback path should never actually be reachable for gender:'female'
  // in practice — but if it ever is, it still only ever resolves to the
  // one body that's actually real (male-normal), never a mislabeled one.
  const AVAILABLE_BASES = { 'male-black': true, 'male-pale': true, 'male-dark-tanned': true };

  // Canvas pixel dimensions per direction — must match the real
  // avatar-<dir>.png files exactly (see docs/avatar-equipment.md); this is
  // also exactly what avatar_rig_anchors.canvas_w/canvas_h store per row,
  // fetched fresh from the DB in loadRigData() below. This hardcoded copy
  // is ONLY the fallback used if that fetch fails outright (no network,
  // Supabase down) — see rigDataFallback().
  const CANVAS_DIMS = {
    front: { w: 636, h: 1514 },
    back:  { w: 584, h: 1514 },
    right: { w: 302, h: 1515 },
    left:  { w: 302, h: 1515 }
  };

  // Hair is its own layer (front/back/left/right, transparent everywhere
  // else — no skin, no clothes baked in) composited on top of the bald
  // base rather than baked into it. That separation is what lets a head
  // item occlude just the part of it the item's own body would physically
  // sit over (a CSS mask, see applyHeadHairMasks below) instead of either
  // hiding the whole hairstyle for anything worn on the head, or having to
  // sculpt one hat mesh that fits every hairstyle's silhouette — see
  // hairBehavior/hairMasks in inventory-data.js and headHairBehavior above.
  //
  // Every hair file shares its pose's exact canvas size with the base
  // body art (see the alignment work that produced them) — so it can
  // reuse the SAME 'avatar-sprite' class/positioning as the base sprite
  // and land in the right place with no separate per-item position data,
  // unlike a small equip layer which only covers a fraction of the frame.
  const HAIR_DIR = '../assets/img/hair/';
  const AVAILABLE_HAIRSTYLES = { 'male-short-spiky': true };
  function hairSrc(pose, gender, hairStyle, hairColour, prefix) {
    const style = hairStyle || 'none';
    if (style === 'none') return null;
    const key = (gender || 'male') + '-' + style;
    if (!AVAILABLE_HAIRSTYLES[key]) return null;
    return (prefix || '') + HAIR_DIR + 'hair-' + style + '-' + (hairColour || 'dark-brown') + '-' + pose + '.png';
  }

  // Legacy percent-of-container positioning — kept ONLY as the very last
  // fallback for a head item that has neither live rig calibration (DB
  // fetch failed) nor a pre-baked `frames` PNG. Nothing in the current
  // catalog should ever actually reach this path; new items should always
  // get a real avatar_rig_items row via the Avatar Rig editor instead.
  const EQUIP_BODY_CENTER_PCT = 61;
  const EQUIP_POSITIONS = {
    male: {
      head: {
        front: { top: 5.5, width: 13 },
        back:  { top: 5.5, width: 13 },
        left:  { top: 5,   width: 12 },
        right: { top: 5,   width: 12 }
      }
    }
  };
  function equipPosition(gender, slotKey, pose) {
    const g = EQUIP_POSITIONS[gender] || EQUIP_POSITIONS.male;
    const slot = g[slotKey] || EQUIP_POSITIONS.male[slotKey];
    return (slot && slot[pose]) || null;
  }

  // ---- head-slot / hair interaction ----
  // Three behaviours a head-slot item can declare (item.hairBehavior):
  //   'none'    (default) — item doesn't touch hair at all, hair renders
  //             normally underneath/around it (e.g. a small forehead gem).
  //   'partial' — hair stays visible except where the item's silhouette
  //             physically covers it — see buildHairMaskDataUrl below,
  //             computed live from the item's OWN current calibration
  //             rather than a pre-baked mask file, so it can never drift
  //             out of sync with wherever an admin has moved the item.
  //   'full'    — hair is hidden outright (a helmet/hood that encloses the
  //             whole head — no hairstyle's silhouette matters once nothing
  //             of it could show anyway). `hidesHair: true` is still
  //             honoured as an older/simpler spelling of the same thing,
  //             so nothing already using it needs to change.
  function headHairBehavior(item) {
    if (!item) return 'none';
    if (item.hairBehavior) return item.hairBehavior;
    if (item.hidesHair) return 'full';
    return 'none';
  }

  function baseSrc(pose, gender, skinColour, prefix) {
    const p = prefix || '';
    const key = (gender || 'male') + '-' + (skinColour || 'normal');
    if (key === 'male-normal') return p + BASE_DIR + 'avatar-' + pose + '.png';
    if (AVAILABLE_BASES[key]) return p + BASE_DIR + key + '-' + pose + '.png';
    return p + BASE_DIR + 'avatar-' + pose + '.png';
  }

  function defaultFrames(prefix) {
    return POSES.map((pose) => ({ key: pose, src: baseSrc(pose, 'male', 'normal', prefix) }));
  }

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // nearest of the 4 poses to a (possibly unbounded) angle, plus the
  // shortest-path target angle to snap to (never the "long way round")
  function nearestPose(a) {
    const raw = ((a % 360) + 360) % 360;
    const idx = Math.round(raw / 90) % 4;
    let delta = idx * 90 - raw;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return { targetAngle: a + delta, idx };
  }

  // ================= rig calibration data (live, shared, cached) =================
  // Fetched once per page load (not once per mounted avatar — a lobby page
  // could mount several) and shared. avatar_rig_anchors/avatar_rig_items
  // are both public-SELECT (see the migration) so this works for every
  // visitor, not just admins — read access isn't privileged, only writing
  // is (via the admin_* RPCs the Avatar Rig editor calls).
  let rigDataPromise = null;
  function rigDataFallback() {
    // Used only if the DB fetch itself fails (offline, Supabase outage) —
    // an empty rig means every item falls back further, to its own
    // `frames` PNG if it has one (see setEquipLayer), so a real outage
    // degrades to "last known-good pre-baked art" rather than a blank spot.
    return { anchors: {}, items: {} };
  }
  function loadRigData(client) {
    if (rigDataPromise) return rigDataPromise;
    if (!client) { rigDataPromise = Promise.resolve(rigDataFallback()); return rigDataPromise; }
    rigDataPromise = Promise.all([
      client.from('avatar_rig_anchors').select('*'),
      client.from('avatar_rig_items').select('*')
    ]).then(([anchorsRes, itemsRes]) => {
      if (anchorsRes.error || itemsRes.error) throw (anchorsRes.error || itemsRes.error);
      const anchors = {};
      (anchorsRes.data || []).forEach((r) => {
        anchors[r.body_type] = anchors[r.body_type] || {};
        anchors[r.body_type][r.direction] = anchors[r.body_type][r.direction] || {};
        anchors[r.body_type][r.direction][r.anchor_type] = r;
      });
      const items = {};
      (itemsRes.data || []).forEach((r) => {
        items[r.body_type] = items[r.body_type] || {};
        items[r.body_type][r.slot] = items[r.body_type][r.slot] || {};
        items[r.body_type][r.slot][r.item_id] = items[r.body_type][r.slot][r.item_id] || {};
        items[r.body_type][r.slot][r.item_id][r.direction] = r;
      });
      return { anchors, items };
    }).catch((err) => {
      console.warn('Avatar rig: could not load calibration data, items will fall back to their own frames PNG if any', err);
      return rigDataFallback();
    });
    return rigDataPromise;
  }

  // The rendered CONTENT box (in px, relative to `container`'s own
  // top-left) that object-fit:contain actually draws into — i.e. the box
  // AFTER .avatar-sprite's padding is applied, BEFORE the image's own
  // aspect ratio further letterboxes it. Measured live from the real
  // computed padding rather than assuming the 9%/11%/5% numbers, so this
  // stays correct even if that CSS ever changes.
  function computeContentBox(container, refImg) {
    const cs = getComputedStyle(refImg);
    return {
      left: parseFloat(cs.paddingLeft) || 0,
      top: parseFloat(cs.paddingTop) || 0,
      width: container.clientWidth,
      height: container.clientHeight
    };
  }

  // Where a canvasW x canvasH image (object-fit:contain) actually lands
  // within a content box that isn't necessarily the same aspect ratio —
  // one axis fills exactly, the other is centred with letterboxing.
  function computeRenderedImageRect(contentBox, naturalW, naturalH) {
    if (!naturalW || !naturalH || !contentBox.width || !contentBox.height) {
      return { left: contentBox.left, top: contentBox.top, width: contentBox.width, height: contentBox.height };
    }
    const boxAspect = contentBox.width / contentBox.height;
    const imgAspect = naturalW / naturalH;
    let renderW, renderH;
    if (imgAspect > boxAspect) { renderW = contentBox.width; renderH = renderW / imgAspect; }
    else { renderH = contentBox.height; renderW = renderH * imgAspect; }
    return {
      left: contentBox.left + (contentBox.width - renderW) / 2,
      top: contentBox.top + (contentBox.height - renderH) / 2,
      width: renderW,
      height: renderH
    };
  }

  // The core placement formula — shared verbatim by the real renderer
  // (below) and the Admin Zone's Avatar Rig editor. Everything is derived
  // from measured/DB values, nothing here is an eyeballed constant:
  //   renderedRect  — computeRenderedImageRect() for THIS direction's base
  //                   body canvas, i.e. where the head/body actually is
  //                   on screen right now, in this container, at this size
  //   canvasW/H     — that direction's real base-art pixel dimensions
  //   anchor        — {center_x_pct, y_pct, width_pct} row for this
  //                   direction + the item's chosen anchor_type
  //   calib         — {offset_x, offset_y, scale, rotation} row for this
  //                   item + direction (or the all-zero/scale-1 default)
  //   itemNaturalW/H — the item's own small view image's pixel size
  // Returns a screen-space rect (px, relative to container) plus rotation.
  function computeItemLayout(renderedRect, canvasW, canvasH, anchor, calib, itemNaturalW, itemNaturalH) {
    const screenScale = renderedRect.width / canvasW; // == renderedRect.height/canvasH, contain preserves aspect
    const anchorCenterXpx = (anchor.center_x_pct / 100) * canvasW;
    const anchorYpx = (anchor.y_pct / 100) * canvasH;
    const itemCenterXpx = anchorCenterXpx + (calib.offset_x || 0);
    const itemBottomYpx = anchorYpx + (calib.offset_y || 0);
    const refWidthPx = (anchor.width_pct / 100) * canvasW;
    const itemWidthPx = (calib.scale != null ? calib.scale : 1) * refWidthPx;
    const aspect = (itemNaturalH && itemNaturalW) ? (itemNaturalH / itemNaturalW) : 1;
    const itemHeightPx = itemWidthPx * aspect;
    const itemLeftPx = itemCenterXpx - itemWidthPx / 2;
    const itemTopPx = itemBottomYpx - itemHeightPx;
    return {
      left: renderedRect.left + itemLeftPx * screenScale,
      top: renderedRect.top + itemTopPx * screenScale,
      width: itemWidthPx * screenScale,
      height: itemHeightPx * screenScale,
      rotation: calib.rotation || 0
    };
  }

  // A hair-occlusion mask, built live from the item's OWN current on-canvas
  // rect (in the base canvas's pixel space, not screen space) — opaque
  // (show hair) everywhere except where the item is currently drawn, so it
  // can never point at a stale position after a recalibration. See
  // hairBehavior:'partial' in inventory-data.js / headHairBehavior above.
  function buildHairMaskDataUrl(canvasW, canvasH, itemImg, itemRectCanvasSpace, rotationDeg) {
    const c = document.createElement('canvas');
    c.width = canvasW; c.height = canvasH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.save();
    const cx = itemRectCanvasSpace.left + itemRectCanvasSpace.width / 2;
    const cy = itemRectCanvasSpace.top + itemRectCanvasSpace.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(((rotationDeg || 0) * Math.PI) / 180);
    try {
      ctx.drawImage(itemImg, -itemRectCanvasSpace.width / 2, -itemRectCanvasSpace.height / 2, itemRectCanvasSpace.width, itemRectCanvasSpace.height);
    } catch (err) { /* image not decoded yet — mask just stays blank/opaque this pass */ }
    ctx.restore();
    return c.toDataURL('image/png');
  }

  function mount(container, opts) {
    if (!container) return null;
    const prefix = (opts && opts.basePathPrefix) || '';
    const staticFront = !!(opts && opts.staticFront);

    container.classList.add('avatar-3d');
    let currentGender = 'male';
    let currentSkinColour = 'default';
    let currentHairStyle = 'none';
    let currentHairColour = 'dark-brown';
    let headHairMode = 'none';       // 'none' | 'partial' | 'full' — see headHairBehavior above
    let currentEquipment = {};       // slotKey -> item, last passed to setAvatarEquipment
    const imgs = defaultFrames(prefix).map((f) => {
      const img = document.createElement('img');
      img.className = 'avatar-sprite';
      img.src = f.src;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.decoding = 'async';
      img.draggable = false;
      img.style.opacity = '0';
      img.addEventListener('error', () => {
        img.dataset.broken = 'true';
        img.style.opacity = '0';
      });
      container.appendChild(img);
      return img;
    });
    imgs[0].style.opacity = '1'; // show the front frame immediately, before the first tick

    // Hair layer — same 4-image crossfade as the base body, painted right
    // on top of it (DOM order below equip layers, so a headwear item that
    // doesn't set hidesHair still draws over hair rather than under it).
    // Starts with no src at all (Bald/"none" needs zero art, zero requests).
    const hairImgs = POSES.map(() => {
      const img = document.createElement('img');
      img.className = 'avatar-sprite avatar-hair-layer';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.decoding = 'async';
      img.draggable = false;
      img.style.opacity = '0';
      img.addEventListener('error', () => {
        img.dataset.broken = 'true';
        img.style.opacity = '0';
      });
      container.appendChild(img);
      return img;
    });

    // Equipped-item indicator: for slots whose item has real per-direction
    // art (item.views), that art is layered on top of the base avatar as
    // its own 4-image set and cross-faded in lock-step with it (see
    // equipLayers/setAvatarEquipment below). For anything without art yet,
    // fall back to a small icon chip along the bottom of the box instead
    // of pretending to be attached to a character with no equipment art.
    const loadout = document.createElement('div');
    loadout.className = 'avatar-loadout';
    container.appendChild(loadout);
    const equipLayers = {}; // slotKey -> [img0, img1, img2, img3], aligned with POSES
    const equipLive = {};   // slotKey -> true if that layer is live-positioned (needs layoutEquipLayer)

    function client() { return window.QZAuth && window.QZAuth.client; }

    // ---- single state machine: 'holding' | 'transitioning' | 'dragging' ----
    let phase = 'holding';
    let angle = 0;            // current render angle, degrees, unbounded (mod 360 in render())
    let poseIdx = 0;          // index into FRAMES of the settled pose (valid while 'holding')
    let holdUntil = 0;        // performance.now() timestamp; only meaningful while 'holding'
    let transition = null;    // { fromAngle, toAngle, toPoseIdx, startTime, duration }
    let lastPointerX = 0;
    let rafId = null;
    let destroyed = false;

    function render() {
      const a = ((angle % 360) + 360) % 360;
      const seg = Math.floor(a / 90) % 4;
      const t = (a - seg * 90) / 90;

      let bOpacity;
      if (t < CROSSFADE_HOLD) bOpacity = 0;
      else if (t > 1 - CROSSFADE_HOLD) bOpacity = 1;
      else bOpacity = smoothstep((t - CROSSFADE_HOLD) / (1 - 2 * CROSSFADE_HOLD));

      imgs.forEach((img, i) => {
        if (i === seg) img.style.opacity = img.dataset.broken ? '0' : String(1 - bOpacity);
        else if (i === (seg + 1) % 4) img.style.opacity = img.dataset.broken ? '0' : String(bOpacity);
        else img.style.opacity = '0';
      });

      // hair rides the same seg/opacity crossfade as the base body. A
      // head item with hairBehavior 'full' still hides it outright (see
      // headHairMode below — nothing of the hairstyle could show past a
      // helmet/hood anyway); 'partial' leaves the crossfade untouched here
      // and instead relies on the live CSS mask already applied per-image
      // by applyHeadHairMasks, which clips just the region the item
      // actually occupies rather than the whole layer.
      hairImgs.forEach((img, i) => {
        if (headHairMode === 'full' || img.dataset.broken) { img.style.opacity = '0'; return; }
        if (i === seg) img.style.opacity = String(1 - bOpacity);
        else if (i === (seg + 1) % 4) img.style.opacity = String(bOpacity);
        else img.style.opacity = '0';
      });

      // equipped-item art rides the exact same seg/opacity math as the
      // base avatar, so it turns in lock-step and is never one frame off
      Object.keys(equipLayers).forEach((slotKey) => {
        const limgs = equipLayers[slotKey];
        limgs.forEach((img, i) => {
          if (i === seg) img.style.opacity = String(1 - bOpacity);
          else if (i === (seg + 1) % 4) img.style.opacity = String(bOpacity);
          else img.style.opacity = '0';
        });
      });
    }

    // settle onto a specific angle/pose: animates there unless reduced
    // motion (or we're already there) asks for an instant cut. This is
    // the ONLY place that starts a hold — auto-advance, arrow clicks and
    // drag-release all funnel through it, so there's one hold timer, ever.
    function settleTo(toAngle, toPoseIdx, now) {
      const duration = reduceMotion() ? 0 : TRANSITION_MS;
      if (duration <= 0 || toAngle === angle) {
        angle = toAngle;
        poseIdx = toPoseIdx;
        phase = 'holding';
        holdUntil = now + HOLD_MS;
        transition = null;
        return;
      }
      transition = { fromAngle: angle, toAngle, toPoseIdx, startTime: now, duration };
      phase = 'transitioning';
    }

    // step forward (+1) or backward (-1) one pose from wherever the
    // avatar visually is right now — interrupts cleanly if already
    // mid-transition, since it always reads the live `angle`.
    function step(direction, now) {
      const toPoseIdx = ((poseIdx + direction) % 4 + 4) % 4;
      settleTo(angle + direction * 90, toPoseIdx, now);
    }

    function tick(now) {
      if (destroyed) return;

      if (phase === 'transitioning') {
        const tr = transition;
        const t = Math.min((now - tr.startTime) / tr.duration, 1);
        angle = tr.fromAngle + (tr.toAngle - tr.fromAngle) * easeInOutCubic(t);
        if (t >= 1) {
          angle = tr.toAngle;
          poseIdx = tr.toPoseIdx;
          phase = 'holding';
          holdUntil = now + HOLD_MS;
          transition = null;
        }
      } else if (phase === 'holding') {
        if (!reduceMotion() && now >= holdUntil) step(1, now);
      }
      // 'dragging': angle is updated live by onPointerMove, nothing to do here

      render();
      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(tick);
    }
    function stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }

    // ---- pointer drag: mouse + touch via the Pointer Events API ----
    // Starting a drag always wins immediately — it just switches phase,
    // so whatever the auto-cycle or an arrow transition was doing simply
    // stops being read on the next tick, no cleanup or queued animation.
    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      phase = 'dragging';
      lastPointerX = e.clientX;
      container.classList.add('dragging');
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
    }
    function onPointerMove(e) {
      if (phase !== 'dragging') return;
      const dx = e.clientX - lastPointerX;
      lastPointerX = e.clientX;
      angle -= dx * DRAG_DEG_PER_PX;
    }
    function endDrag() {
      if (phase !== 'dragging') return;
      container.classList.remove('dragging');
      const { targetAngle, idx } = nearestPose(angle);
      settleTo(targetAngle, idx, performance.now());
    }
    function onPointerUp(e) {
      try { container.releasePointerCapture(e.pointerId); } catch (_) {}
      endDrag();
    }

    // staticFront: a small decorative mount (e.g. the Anagram Quest lobby's
    // avatar circle) that should just show the front pose, permanently —
    // no auto-rotation, no drag-to-turn, no rAF loop running at all. Still
    // the exact same renderer/state/equipment data as the interactive
    // viewer, just never advanced past angle 0 — so it stays correct
    // through setBaseAppearance/setHairstyle/setAvatarEquipment calls with
    // zero extra code path, same as the interactive mount.
    if (!staticFront) {
      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerUp);
      // in case the pointer is released outside the element entirely
      window.addEventListener('pointerup', onPointerUp);
    }

    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }
    if (!staticFront) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (!document.hidden) start();
      holdUntil = performance.now() + HOLD_MS; // hold on Front before the first auto-advance
    }
    render(); // paint the initial (front) frame either way

    // ---- manual pose stepping (wired to the left/right arrow buttons) ----
    function next() { step(1, performance.now()); }
    function prev() { step(-1, performance.now()); }

    // ---- equipment display ----
    // A slot with real art (item.views: {front,right,back,left}) gets its
    // own 4-image layer stacked on top of the base avatar, at the right
    // depth for that slot (head art after the body, for instance) so it
    // reads as worn rather than pasted on. Everything without art yet
    // falls back to an icon chip — still real, immediate feedback wired
    // to the same equippedItems state, just not pretending to be pixel-
    // attached to a character with no art for that slot.
    const SLOT_ORDER = ['back', 'body', 'legs', 'boots', 'necklace', 'head', 'gloves', 'mainHand', 'offHand', 'accessory'];
    function clearEquipLayer(slotKey) {
      const limgs = equipLayers[slotKey];
      if (!limgs) return;
      limgs.forEach((img) => img.remove());
      delete equipLayers[slotKey];
      delete equipLive[slotKey];
    }

    // Live-position one slot's 4 view images against the current rig data
    // — called right after the images are created/loaded, and again on
    // window resize (the container's own on-screen size changed, so the
    // screen-space rect every item is placed at must be recomputed; the
    // underlying canvas-space calibration itself hasn't changed at all).
    function layoutEquipLayer(slotKey, rigData) {
      const limgs = equipLayers[slotKey];
      const item = currentEquipment[slotKey];
      if (!limgs || !item) return;
      const bodyType = currentGender || 'male';
      POSES.forEach((pose, i) => {
        const img = limgs[i];
        if (!img.dataset.itemNaturalW) return; // not decoded yet — onload handler will call this again
        const dims = CANVAS_DIMS[pose];
        const baseImg = imgs[i];
        const contentBox = computeContentBox(container, baseImg);
        const renderedRect = computeRenderedImageRect(contentBox, dims.w, dims.h);
        const anchorRow = rigData.anchors[bodyType] && rigData.anchors[bodyType][pose] && rigData.anchors[bodyType][pose][img.dataset.anchorType];
        if (!anchorRow) { img.style.opacity = '0'; img.dataset.broken = 'true'; return; }
        const calibRow = (rigData.items[bodyType] && rigData.items[bodyType][slotKey] && rigData.items[bodyType][slotKey][item.id] && rigData.items[bodyType][slotKey][item.id][pose]) || {};
        const layout = computeItemLayout(
          renderedRect, dims.w, dims.h, anchorRow, calibRow,
          Number(img.dataset.itemNaturalW), Number(img.dataset.itemNaturalH)
        );
        img.style.left = layout.left + 'px';
        img.style.top = layout.top + 'px';
        img.style.width = layout.width + 'px';
        img.style.height = layout.height + 'px';
        img.style.transform = layout.rotation ? 'rotate(' + layout.rotation + 'deg)' : 'none';
        img.dataset.broken = '';
      });
      if (headHairMasks && slotKey === 'head') applyHeadHairMasks();
    }
    function layoutAllLiveEquipLayers() {
      loadRigData(client()).then((rigData) => {
        Object.keys(equipLive).forEach((slotKey) => { if (equipLive[slotKey]) layoutEquipLayer(slotKey, rigData); });
      });
    }
    // A plain debounced setTimeout, not requestAnimationFrame — rAF is
    // throttled/paused entirely for a backgrounded/hidden tab in real
    // browsers, which would leave equipment mispositioned indefinitely
    // until the tab regains focus. This is a one-off layout recompute,
    // not a continuous animation, so it has no real need to be paint-
    // frame-synced anyway.
    let resizeTimer = null;
    function onWindowResize() {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resizeTimer = null; layoutAllLiveEquipLayers(); }, 80);
    }
    window.addEventListener('resize', onWindowResize);

    // Equip layers come in three shapes, tried in this order:
    //
    // - LIVE calibration (item.views + a real avatar_rig_items row, or
    //   even just the fallback defaults if no row exists yet): positioned
    //   in real screen pixels every layout pass via computeItemLayout, so
    //   an Avatar Rig editor save takes effect for every player instantly.
    //   This is the path every current and future item should use.
    // - item.frames: a full-canvas PNG per pose, pre-baked to already sit
    //   at a fixed position (same canvas size as that pose's base body
    //   art). Used ONLY if the rig-data fetch itself fails (offline,
    //   Supabase outage) — a real fallback to "last known-good art",
    //   never the normal path anymore.
    // - item.views + the old EQUIP_POSITIONS percentages: last-resort,
    //   for a slot that isn't full-canvas and has no rig row and no
    //   frames either.
    function setEquipLayer(slotKey, item) {
      clearEquipLayer(slotKey);
      const bodyType = currentGender || 'male';
      let rigLooksAvailable = false;
      loadRigData(client()).then((rigData) => {
        rigLooksAvailable = !!(rigData.anchors[bodyType] && Object.keys(rigData.anchors[bodyType]).length);
        const useFrames = !rigLooksAvailable && item.frames;
        const limgs = POSES.map((pose) => {
          const img = document.createElement('img');
          const directionClass = 'avatar-equip-' + slotKey + ' avatar-equip-' + slotKey + '-' + pose;
          if (useFrames) {
            img.className = 'avatar-sprite avatar-equip-frame ' + directionClass;
            img.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.5)) drop-shadow(0 0 9px rgba(255,210,90,0.3))';
            img.src = prefix + item.frames[pose];
          } else if (item.views) {
            img.className = 'avatar-equip-live ' + directionClass;
            img.style.position = 'absolute';
            img.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.5)) drop-shadow(0 0 9px rgba(255,210,90,0.3))';
            img.dataset.anchorType = item.anchorType || 'skull';
            img.src = prefix + item.views[pose];
            img.addEventListener('load', () => {
              img.dataset.itemNaturalW = String(img.naturalWidth);
              img.dataset.itemNaturalH = String(img.naturalHeight);
              loadRigData(client()).then((rd) => layoutEquipLayer(slotKey, rd));
            });
          } else {
            // no views art at all — nothing to place; the loadout chip
            // (see setAvatarEquipment) is this item's only representation
            img.style.display = 'none';
          }
          img.alt = '';
          img.setAttribute('aria-hidden', 'true');
          img.decoding = 'async';
          img.draggable = false;
          img.style.opacity = '0';
          img.addEventListener('error', () => { img.style.opacity = '0'; img.dataset.broken = 'true'; });
          container.appendChild(img);
          return img;
        });
        equipLayers[slotKey] = limgs;
        equipLive[slotKey] = !useFrames && !!item.views;
        if (!useFrames && item.views) layoutEquipLayer(slotKey, rigData);
        render();
      });
    }
    function setAvatarEquipment(slots) {
      const items = slots || {};
      currentEquipment = items;
      loadout.innerHTML = '';
      SLOT_ORDER.forEach((slotKey) => {
        const item = items[slotKey];
        if (item && (item.frames || item.views)) {
          setEquipLayer(slotKey, item);
          return;
        }
        clearEquipLayer(slotKey);
        if (!item) return;
        const chip = document.createElement('span');
        chip.className = 'avatar-loadout-chip';
        chip.textContent = item.icon || '';
        chip.title = item.name || '';
        loadout.appendChild(chip);
      });
      const headItem = items.head;
      headHairMode = headHairBehavior(headItem);
      headHairMasks = headHairMode === 'partial' ? true : null;
      applyHeadHairMasks();
      render(); // reflect the change immediately, don't wait for the next tick
    }

    // Applies (or clears) the equipped head item's per-pose hair-occlusion
    // mask to each of the 4 hair images. When the head item is live-
    // positioned (the normal path now), the mask is generated fresh from
    // that item's OWN current on-canvas rect via buildHairMaskDataUrl —
    // it can never point at a stale position, because it's derived from
    // the exact same layout the item itself was just drawn at. Falls back
    // to a pre-baked hairMasks[pose] file only for the legacy `frames`
    // fallback path (rig data unavailable).
    let headHairMasks = null; // true = live-generate; else a legacy {front,right,...} map; else null = no mask
    function applyHeadHairMasks() {
      const headLayer = equipLayers.head;
      hairImgs.forEach((img, i) => {
        const pose = POSES[i];
        if (!headHairMasks) { img.style.maskImage = 'none'; img.style.webkitMaskImage = 'none'; return; }

        if (headHairMasks === true && headLayer && equipLive.head) {
          const itemImg = headLayer[i];
          const dims = CANVAS_DIMS[pose];
          if (!itemImg || !itemImg.dataset.itemNaturalW || !dims) { img.style.maskImage = 'none'; img.style.webkitMaskImage = 'none'; return; }
          const bodyType = currentGender || 'male';
          loadRigData(client()).then((rigData) => {
            const item = currentEquipment.head;
            const anchorRow = rigData.anchors[bodyType] && rigData.anchors[bodyType][pose] && rigData.anchors[bodyType][pose][itemImg.dataset.anchorType];
            if (!anchorRow || !item) return;
            const calibRow = (rigData.items[bodyType] && rigData.items[bodyType].head && rigData.items[bodyType].head[item.id] && rigData.items[bodyType].head[item.id][pose]) || {};
            // rect in CANVAS-SPACE (not screen space) — same maths as
            // computeItemLayout's inner steps, just without the final
            // screenScale multiply, since the mask canvas IS the base
            // canvas's own pixel space.
            const anchorCenterXpx = (anchorRow.center_x_pct / 100) * dims.w;
            const anchorYpx = (anchorRow.y_pct / 100) * dims.h;
            const centerX = anchorCenterXpx + (calibRow.offset_x || 0);
            const bottomY = anchorYpx + (calibRow.offset_y || 0);
            const refWidthPx = (anchorRow.width_pct / 100) * dims.w;
            const widthPx = (calibRow.scale != null ? calibRow.scale : 1) * refWidthPx;
            const aspect = Number(itemImg.dataset.itemNaturalH) / Number(itemImg.dataset.itemNaturalW);
            const heightPx = widthPx * aspect;
            const rectCanvasSpace = { left: centerX - widthPx / 2, top: bottomY - heightPx, width: widthPx, height: heightPx };
            const dataUrl = buildHairMaskDataUrl(dims.w, dims.h, itemImg, rectCanvasSpace, calibRow.rotation || 0);
            const url = 'url(' + JSON.stringify(dataUrl) + ')';
            img.style.maskImage = url; img.style.webkitMaskImage = url;
            img.style.maskMode = 'alpha'; img.style.maskRepeat = 'no-repeat'; img.style.webkitMaskRepeat = 'no-repeat';
            img.style.maskPosition = 'center'; img.style.webkitMaskPosition = 'center';
            img.style.maskSize = 'contain'; img.style.webkitMaskSize = 'contain';
            img.style.maskOrigin = 'content-box'; img.style.webkitMaskOrigin = 'content-box';
            img.style.maskClip = 'content-box'; img.style.webkitMaskClip = 'content-box';
          });
          return;
        }

        // legacy pre-baked mask file fallback
        const maskUrl = headHairMasks && headHairMasks !== true && headHairMasks[pose];
        if (!maskUrl) { img.style.maskImage = 'none'; img.style.webkitMaskImage = 'none'; return; }
        const url = 'url(' + JSON.stringify(prefix + maskUrl) + ')';
        img.style.maskImage = url; img.style.webkitMaskImage = url;
        img.style.maskMode = 'alpha'; img.style.maskRepeat = 'no-repeat'; img.style.webkitMaskRepeat = 'no-repeat';
        img.style.maskPosition = 'center'; img.style.webkitMaskPosition = 'center';
        img.style.maskSize = 'contain'; img.style.webkitMaskSize = 'contain';
        img.style.maskOrigin = 'content-box'; img.style.webkitMaskOrigin = 'content-box';
        img.style.maskClip = 'content-box'; img.style.webkitMaskClip = 'content-box';
      });
    }

    // Swap which hairstyle/colour the 4 hair frames point at. Independent
    // of setBaseAppearance (skin tone) but resolved against the SAME
    // currentGender, since hair art is per-gender too — a Gender switch
    // (see setBaseAppearance below) re-resolves whatever hairstyle is
    // already selected rather than leaving it pointed at the old body's art.
    function refreshHair() {
      POSES.forEach((pose, i) => {
        const img = hairImgs[i];
        const src = hairSrc(pose, currentGender, currentHairStyle, currentHairColour, prefix);
        img.dataset.broken = '';
        if (!src) { img.removeAttribute('src'); img.dataset.broken = 'true'; return; }
        img.src = src;
      });
    }
    function setHairstyle(hairStyle, hairColour) {
      currentHairStyle = hairStyle || 'none';
      currentHairColour = hairColour || 'dark-brown';
      refreshHair();
    }

    // Swap which body art the 4 base sprites point at — e.g. after loading
    // an account's avatar_customization row, or live as someone picks a
    // different option on the Customise screen. Unknown/unavailable combos
    // quietly fall back to the original default body (see baseSrc above)
    // rather than showing a broken image.
    function setBaseAppearance(gender, skinColour) {
      currentGender = gender || 'male';
      currentSkinColour = skinColour || 'default';
      imgs.forEach((img, i) => {
        const pose = POSES[i];
        img.dataset.broken = '';
        img.src = baseSrc(pose, currentGender, currentSkinColour, prefix);
      });
      // any already-equipped gear needs repositioning too — a body swap
      // (e.g. switching Gender on the Customise screen) can change which
      // body_type row of rig data applies
      Object.keys(equipLayers).forEach((slotKey) => {
        if (equipLive[slotKey]) return; // layoutAllLiveEquipLayers (below) covers these
        equipLayers[slotKey].forEach((img, i) => {
          if (img.classList.contains('avatar-equip-frame')) return; // full-canvas, positions itself
          const pos = equipPosition(currentGender, slotKey, POSES[i]);
          if (pos) { img.style.top = pos.top + '%'; img.style.width = pos.width + '%'; }
        });
      });
      layoutAllLiveEquipLayers();
      // and the current hairstyle, if any, needs its art path re-resolved
      // against the new gender too
      refreshHair();
    }

    function destroy() {
      destroyed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', onWindowResize);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointerup', onPointerUp);
      imgs.forEach((img) => img.remove());
      hairImgs.forEach((img) => img.remove());
      Object.keys(equipLayers).forEach(clearEquipLayer);
      loadout.remove();
      container.classList.remove('dragging');
    }

    window.addEventListener('pagehide', destroy, { once: true });

    return { destroy, setAvatarEquipment, setBaseAppearance, setHairstyle, next, prev };
  }

  window.QZAvatarViewer = {
    mount,
    // exported so the Admin Zone's Avatar Rig editor uses the EXACT same
    // math as the real renderer above — one source of truth, see the
    // file-level comment.
    loadRigData, computeContentBox, computeRenderedImageRect, computeItemLayout, buildHairMaskDataUrl,
    CANVAS_DIMS, POSES
  };
})();
