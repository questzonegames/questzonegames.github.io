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
  // unlike a small equip layer (EQUIP_POSITIONS) which only covers a
  // fraction of the frame.
  const HAIR_DIR = '../assets/img/hair/';
  const AVAILABLE_HAIRSTYLES = { 'male-short-spiky': true };
  function hairSrc(pose, gender, hairStyle, hairColour, prefix) {
    const style = hairStyle || 'none';
    if (style === 'none') return null;
    const key = (gender || 'male') + '-' + style;
    if (!AVAILABLE_HAIRSTYLES[key]) return null;
    return (prefix || '') + HAIR_DIR + 'hair-' + style + '-' + (hairColour || 'dark-brown') + '-' + pose + '.png';
  }

  // Single source of truth for where each equip layer sits on the body,
  // as a percentage of the shared avatar box (top = % of box height,
  // width = % of box width — same units the CSS `top`/`width` properties
  // use). This used to be hand-duplicated as CSS in customise.html,
  // inventory.html AND profile/index.html; they'd already drifted out of
  // sync (profile/index.html's .avatar-sprite padding didn't match the
  // other two, silently shifting where gear landed depending which page
  // you were looking at). Now there's exactly one place this lives.
  //
  // Keyed by gender because a differently-proportioned body needs its own
  // numbers, not a shared guess — 'male' is real today; add a 'female' key
  // here once that base model exists and every item worn on it will just
  // pick up correct placement automatically, no per-page hunting required.
  // `left` here (61%) isn't an eyeballed number: .avatar-sprite is
  // `width:100%` PLUS `padding:9% 11% 5%` with the default content-box
  // sizing, so the rendered body/hair image sits centred in a content box
  // that itself starts 11% in from the container's left edge — i.e. the
  // body's true visual centre is at 11% + 50% = 61% of the container width,
  // not 50%. Every equip layer needs this same 61% (measured empirically
  // against the actual rendered head, then confirmed algebraically) to
  // land centred on the body instead of ~11% off to one side; it doesn't
  // vary by slot or pose, only by this shared padding, so it's one constant
  // rather than per-position data. top/width below are each item's own
  // fit and DO vary per slot/pose as before.
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
  //   'partial' — hair stays visible except where the item's hairMasks say
  //             it's physically covered (see applyHairOcclusion below).
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
    let headHairMasks = null;        // the equipped head item's hairMasks, keyed by pose (only meaningful for 'partial')
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
    const equipLayers = {}; // slotKey -> [img0, img1, img2, img3], aligned with FRAMES

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
      // and instead relies on the CSS mask already applied per-image by
      // applyHeadHairMasks, which clips just the region the item actually
      // occupies rather than the whole layer.
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
    }
    // Equip layers come in two shapes:
    //
    // - item.frames: a full-canvas PNG per pose, pre-baked at build time to
    //   already sit at the item's correct on-body pixel position (same
    //   canvas dimensions as that pose's base body/hair art). Rendered with
    //   the exact same 'avatar-sprite' box/contain-fit as the base body, so
    //   it lands correctly by construction — no percentage math to get
    //   right, and no way for it to drift from the head, because it's
    //   subject to the identical CSS as the head is. This is what fixed the
    //   crown floating/offset: EQUIP_POSITIONS's percent-of-container
    //   anchoring couldn't be made to agree with .avatar-sprite's own
    //   padding-driven centering across every rendering context, so the
    //   item now shares that positioning outright instead of approximating
    //   it. Preferred for anything anchored to the head/body silhouette.
    // - item.views: a small, cropped per-pose image positioned via
    //   EQUIP_POSITIONS (top/width percent of the equip container) — still
    //   supported for slots that aren't full-canvas (a necklace, a ring)
    //   where a tiny fixed-size icon genuinely is simplest.
    function setEquipLayer(slotKey, item) {
      clearEquipLayer(slotKey);
      const frames = item.frames;
      const limgs = POSES.map((pose) => {
        const img = document.createElement('img');
        // both a slot-general class (avatar-equip-head) and a per-
        // direction one (avatar-equip-head-front/-right/-back/-left) —
        // most gear can share one position across all 4 views, but an
        // item can also carry its own per-direction scale/offset/tilt
        // via the more specific class when a single placement doesn't
        // fit every angle (e.g. side views needing a narrower crown)
        const directionClass = 'avatar-equip-' + slotKey + ' avatar-equip-' + slotKey + '-' + pose;
        if (frames) {
          img.className = 'avatar-sprite avatar-equip-frame ' + directionClass;
          // avatar-sprite's own filter is tuned for the base body's blue
          // glow — equip art keeps its distinct gold-ish glow instead
          img.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.5)) drop-shadow(0 0 9px rgba(255,210,90,0.3))';
          img.src = prefix + frames[pose];
        } else {
          img.className = 'avatar-equip-layer ' + directionClass;
          // overrides the CSS rule's left:50% — see EQUIP_BODY_CENTER_PCT
          img.style.left = EQUIP_BODY_CENTER_PCT + '%';
          const pos = equipPosition(currentGender, slotKey, pose);
          if (pos) { img.style.top = pos.top + '%'; img.style.width = pos.width + '%'; }
          img.src = prefix + item.views[pose];
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
    }
    function setAvatarEquipment(slots) {
      const items = slots || {};
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
      headHairMasks = (headHairMode === 'partial' && headItem && headItem.hairMasks) ? headItem.hairMasks : null;
      applyHeadHairMasks();
      render(); // reflect the change immediately, don't wait for the next tick
    }

    // Applies (or clears) the equipped head item's per-pose hair-occlusion
    // mask to each of the 4 hair images — a real alpha mask (mask-mode:
    // alpha), not a colour-key or a crop hack, generated once per head item
    // from that item's own art at its actual on-head position/scale (see
    // the tooling that produced assets/img/equipment/head/masks/). Sizing
    // it to the same content-box/contain-fit the hair image itself renders
    // with (mask-origin/-clip: content-box, mask-size: contain) is what
    // keeps the mask aligned to the hair pixels it's meant to cover instead
    // of the element's raw box, since .avatar-sprite's padding means those
    // aren't the same thing. Every property is set inline here rather than
    // in a page's CSS so there's exactly one place this logic lives (same
    // reasoning as EQUIP_POSITIONS above), and it stays correct across a
    // hairstyle swap for free — the mask lives on the pose's <img> itself,
    // independent of which hairstyle src that image currently points at.
    function applyHeadHairMasks() {
      hairImgs.forEach((img, i) => {
        const pose = POSES[i];
        const maskUrl = headHairMasks && headHairMasks[pose];
        if (!maskUrl) {
          img.style.maskImage = 'none';
          img.style.webkitMaskImage = 'none';
          return;
        }
        const url = 'url(' + JSON.stringify(prefix + maskUrl) + ')';
        img.style.maskImage = url;
        img.style.webkitMaskImage = url;
        img.style.maskMode = 'alpha';
        img.style.maskRepeat = 'no-repeat';
        img.style.webkitMaskRepeat = 'no-repeat';
        img.style.maskPosition = 'center';
        img.style.webkitMaskPosition = 'center';
        img.style.maskSize = 'contain';
        img.style.webkitMaskSize = 'contain';
        img.style.maskOrigin = 'content-box';
        img.style.webkitMaskOrigin = 'content-box';
        img.style.maskClip = 'content-box';
        img.style.webkitMaskClip = 'content-box';
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
      // EQUIP_POSITIONS numbers apply, and worn items shouldn't keep
      // sitting at the previous body's placement
      Object.keys(equipLayers).forEach((slotKey) => {
        equipLayers[slotKey].forEach((img, i) => {
          // frame-based layers (see setEquipLayer) are full-canvas and
          // positioned entirely by the 'avatar-sprite' class itself, same
          // as the base body — nothing here to recompute for them
          if (img.classList.contains('avatar-equip-frame')) return;
          const pos = equipPosition(currentGender, slotKey, POSES[i]);
          if (pos) { img.style.top = pos.top + '%'; img.style.width = pos.width + '%'; }
        });
      });
      // and the current hairstyle, if any, needs its art path re-resolved
      // against the new gender too
      refreshHair();
    }

    function destroy() {
      destroyed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
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

  window.QZAvatarViewer = { mount };
})();
