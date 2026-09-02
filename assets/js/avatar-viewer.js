// ===== Quest Zone — Profile avatar viewer =====
//
// A sprite-based pseudo-3D viewer: it crossfades between four real
// renders of the player's avatar (front / left / back / right) as the
// angle turns, rather than rendering an approximated 3D model. This is a
// deliberate choice — the four supplied images ARE the avatar's source of
// truth, so showing them directly (with a smooth dissolve between
// neighbours) always looks exactly like the avatar, at every angle,
// instead of risking a crude geometric stand-in.
//
//   window.QZAvatarViewer.mount(container) -> { destroy, setAvatarEquipment }
//
// container is the element the avatar fills (e.g. #avatar-3d) — it should
// be position:relative/absolute with a defined size; this module only
// ever touches elements it creates inside that container.
(function () {
  const ROTATION_PERIOD_S = 9;       // one full auto-rotation, ~9s
  const RESUME_DELAY_MS = 2600;      // pause length after a manual drag
  const DEG_PER_MS_AUTO = 360 / (ROTATION_PERIOD_S * 1000);
  const DRAG_DEG_PER_PX = 0.5;       // manual-drag sensitivity
  const MOMENTUM_DECAY_PER_MS = 0.994; // multiplicative decay per ms (minimal)
  const MAX_MOMENTUM_DEG_PER_MS = DEG_PER_MS_AUTO * 14; // capped, brief coast
  const HOLD = 0.35;                 // fraction of each 90° segment spent fully on one frame

  // angle order going around the character, 90° apart
  const FRAMES = [
    { key: 'front', angle: 0,   src: '../assets/img/avatar/avatar-front.png' },
    { key: 'left',  angle: 90,  src: '../assets/img/avatar/avatar-left.png' },
    { key: 'back',  angle: 180, src: '../assets/img/avatar/avatar-back.png' },
    { key: 'right', angle: 270, src: '../assets/img/avatar/avatar-right.png' }
  ];

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
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

    let angle = 0;           // current facing angle, degrees, 0-360
    const autoDeg = DEG_PER_MS_AUTO;
    let momentum = 0;        // degrees/ms carried over after a drag release
    let dragging = false;
    let resumeAt = 0;        // performance.now() timestamp; auto-rotation resumes after this
    let lastPointerX = 0;
    let lastMoveT = 0;
    let velocitySample = 0;  // degrees/ms, measured during the drag
    let rafId = null;
    let lastTick = null;
    let destroyed = false;

    function render() {
      angle = ((angle % 360) + 360) % 360;
      const seg = Math.floor(angle / 90) % 4;
      const t = (angle - seg * 90) / 90;

      let bOpacity;
      if (t < HOLD) bOpacity = 0;
      else if (t > 1 - HOLD) bOpacity = 1;
      else bOpacity = smoothstep((t - HOLD) / (1 - 2 * HOLD));

      imgs.forEach((img, i) => {
        if (i === seg) img.style.opacity = img.dataset.broken ? '0' : String(1 - bOpacity);
        else if (i === (seg + 1) % 4) img.style.opacity = img.dataset.broken ? '0' : String(bOpacity);
        else img.style.opacity = '0';
      });
    }

    function tick(now) {
      if (destroyed) return;
      if (lastTick === null) lastTick = now;
      const dt = Math.min(now - lastTick, 50); // clamp huge gaps (tab was hidden, etc.)
      lastTick = now;

      if (dragging) {
        // angle already updated live by pointermove
      } else if (momentum !== 0) {
        angle += momentum * dt;
        const decay = Math.pow(MOMENTUM_DECAY_PER_MS, dt);
        momentum *= decay;
        if (Math.abs(momentum) < DEG_PER_MS_AUTO * 0.5) momentum = 0;
      } else if (!reduceMotion() && now >= resumeAt) {
        angle += autoDeg * dt;
      }

      render();
      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (rafId !== null) return;
      lastTick = null;
      rafId = requestAnimationFrame(tick);
    }
    function stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }

    // ---- pointer drag: mouse + touch via the Pointer Events API ----
    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      momentum = 0;
      lastPointerX = e.clientX;
      lastMoveT = performance.now();
      velocitySample = 0;
      container.classList.add('dragging');
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const now = performance.now();
      const dx = e.clientX - lastPointerX;
      lastPointerX = e.clientX;
      angle -= dx * DRAG_DEG_PER_PX;
      const dt = Math.max(now - lastMoveT, 1);
      lastMoveT = now;
      velocitySample = (-dx * DRAG_DEG_PER_PX) / dt;
    }
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      container.classList.remove('dragging');
      let v = velocitySample;
      if (v > MAX_MOMENTUM_DEG_PER_MS) v = MAX_MOMENTUM_DEG_PER_MS;
      if (v < -MAX_MOMENTUM_DEG_PER_MS) v = -MAX_MOMENTUM_DEG_PER_MS;
      momentum = v;
      resumeAt = performance.now() + RESUME_DELAY_MS;
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
    render();

    // ---- equipment-slot readiness (not implemented yet) ----
    // Future cosmetics would layer additional per-angle sprite sets (one
    // image per FRAMES entry per equipped item) on top of the base avatar
    // here, keyed by slot, and cross-fade them in lock-step with the base
    // render() above. Accepting the call now — without acting on it — lets
    // calling code integrate against the final shape early.
    function setAvatarEquipment(_slots) {
      // slots: { head, necklace, body, legs, boots, gloves, back, mainHand, offHand, accessory }
      // no-op until per-slot sprite art exists
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
      container.classList.remove('dragging');
    }

    window.addEventListener('pagehide', destroy, { once: true });

    return { destroy, setAvatarEquipment };
  }

  window.QZAvatarViewer = { mount };
})();
