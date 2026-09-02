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
//   window.QZAvatarViewer.mount(container)
//     -> { destroy, setAvatarEquipment, next, prev }
//
// container is the element the avatar fills (e.g. #avatar-3d) — it should
// be position:relative/absolute with a defined size; this module only
// ever touches elements it creates inside that container.
(function () {
  const HOLD_MS = 5000;         // how long a settled pose stays put
  const TRANSITION_MS = 450;    // smooth turn between adjacent poses
  const DRAG_DEG_PER_PX = 0.5;  // manual-drag sensitivity
  const CROSSFADE_HOLD = 0.35;  // fraction of a 90° sweep spent fully on one frame

  // clockwise pose order: Front -> Right -> Back -> Left -> Front
  const FRAMES = [
    { key: 'front', src: '../assets/img/avatar/avatar-front.png' },
    { key: 'right', src: '../assets/img/avatar/avatar-right.png' },
    { key: 'back',  src: '../assets/img/avatar/avatar-back.png' },
    { key: 'left',  src: '../assets/img/avatar/avatar-left.png' }
  ];

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

  function mount(container) {
    if (!container) return null;

    container.classList.add('avatar-3d');
    const imgs = FRAMES.map((f) => {
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

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    // in case the pointer is released outside the element entirely
    window.addEventListener('pointerup', onPointerUp);

    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (!document.hidden) start();
    holdUntil = performance.now() + HOLD_MS; // hold on Front before the first auto-advance
    render();

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
    function setEquipLayer(slotKey, views) {
      clearEquipLayer(slotKey);
      const limgs = FRAMES.map((f) => {
        const img = document.createElement('img');
        img.className = 'avatar-equip-layer avatar-equip-' + slotKey;
        img.src = views[f.key];
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
        if (item && item.views) {
          setEquipLayer(slotKey, item.views);
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
      render(); // reflect the change immediately, don't wait for the next tick
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
      Object.keys(equipLayers).forEach(clearEquipLayer);
      loadout.remove();
      container.classList.remove('dragging');
    }

    window.addEventListener('pagehide', destroy, { once: true });

    return { destroy, setAvatarEquipment, next, prev };
  }

  window.QZAvatarViewer = { mount };
})();
