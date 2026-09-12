// ===== Starbound — base game engine =====
//
// Architecture at a glance:
//   - ALL tuning numbers live in starbound-config.js (window.STARBOUND_
//     CONFIG) — nothing here should ever hard-code a gameplay value that
//     belongs there. See that file's own header comment.
//   - Canvas is drawn at a FIXED design resolution (CONFIG.design, i.e.
//     1672x941 — matching the background art exactly) and scaled to fit
//     the browser responsively via CSS aspect-ratio + a devicePixelRatio-
//     aware resize, the same technique games/space-snake/index.html uses
//     for its square canvas, generalized to a non-square ratio. Every
//     coordinate in update()/draw() is a design-space pixel; the resize
//     handler is the ONLY place that deals with real screen pixels.
//   - Obstacles and fuel pickups are plain data objects updated by one
//     shared loop; which TYPES can spawn is entirely config-driven (see
//     CONFIG.obstacles.zones), and adding a new hazard later only means
//     adding a zone/type entry plus one entry in OBSTACLE_DRAWERS below
//     — no other code needs to change.
//   - No XP/achievements/shop/save-progress wiring yet, per spec. The
//     one future hook point is marked with a TODO near GAME_KEY below.
(function () {
  const CONFIG = window.STARBOUND_CONFIG;
  const DESIGN_W = CONFIG.design.width;
  const DESIGN_H = CONFIG.design.height;

  // Not used yet — see the TODO at the real call site (finishRun()) for
  // exactly where a future award_xp/record_game_result RPC call would
  // go, matching the pattern games/space-snake/index.html and
  // games/anagram-quest/anagram-quest.js already use.
  const GAME_KEY = 'starbound';

  // ================= DOM refs =================
  const canvas = document.getElementById('sb-canvas');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.getElementById('sb-stage-wrap');

  const screens = {
    MENU: document.getElementById('sb-screen-menu'),
    GAMEOVER: document.getElementById('sb-screen-gameover'),
    COMPLETE: document.getElementById('sb-screen-complete')
  };
  const hud = document.getElementById('sb-hud');
  const altitudeValueEl = document.getElementById('sb-altitude-value');
  const fuelFillEl = document.getElementById('sb-fuel-fill');
  const fuelPctEl = document.getElementById('sb-fuel-pct');

  const btnStartLaunch = document.getElementById('sb-btn-start-launch');
  const btnRetry = document.getElementById('sb-btn-retry');
  const btnBackToMenuGameover = document.getElementById('sb-btn-back-menu-gameover');
  const btnContinueComplete = document.getElementById('sb-btn-back-menu-complete');
  const gameoverAltitudeEl = document.getElementById('sb-gameover-altitude');
  const gameoverHeadingEl = document.getElementById('sb-gameover-heading');
  const completeAltitudeEl = document.getElementById('sb-complete-altitude');

  const btnLeft = document.getElementById('sb-btn-left');
  const btnRight = document.getElementById('sb-btn-right');

  // ================= asset loading =================
  const IMAGE_DIR = '../../assets/img/starbound/';
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // a missing/broken art file degrades to "just don't draw it", never a crash
      img.src = IMAGE_DIR + src;
    });
  }
  let assetsReady = false;
  // The 10 background scenes, built ONCE here with a PERMANENT worldY —
  // see buildBackgroundScenes() below. Populated before assetsReady ever
  // becomes true, so nothing in the render path ever needs to check
  // "has this scene's position been assigned yet".
  let BACKGROUND_SCENES = [];
  async function preloadAssets() {
    const stages = CONFIG.background.stages;
    const loaded = await Promise.all(stages.map((s) => loadImage(s.image)));
    BACKGROUND_SCENES = buildBackgroundScenes(stages, loaded);
    assetsReady = true;
  }

  // ================= responsive canvas sizing =================
  // Same technique as games/space-snake/index.html's resizeCanvas():
  // the CSS box is sized (via #sb-stage-wrap's aspect-ratio + width:
  // min(...)) to fit the viewport without distorting the ratio; here we
  // just read the resulting CSS pixel size and set the canvas's actual
  // backing-store resolution to that times devicePixelRatio, then scale
  // the drawing context so every draw call can keep using DESIGN_W/H
  // design-space coordinates regardless of real screen size/zoom.
  let scaleX = 1, scaleY = 1; // design-px -> backing-store-px, kept for input hit-testing math
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const scale = (cssW / DESIGN_W) * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    scaleX = cssW / DESIGN_W;
    scaleY = cssH / DESIGN_H;
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 80);
  });

  // ================= game state =================
  const STATE = { MENU: 'MENU', LIFTOFF: 'LIFTOFF', FLYING: 'FLYING', GAMEOVER: 'GAMEOVER', COMPLETE: 'COMPLETE' };
  const state = {
    phase: STATE.MENU,
    rocketX: DESIGN_W / 2,
    rocketY: CONFIG.rocket.padScreenY,
    liftoffStartAt: 0,
    scrollSpeed: 0,        // current downward world-scroll speed, px/sec (ramps 0 -> cruise during liftoff)
    scrollOffset: 0,       // accumulated scroll, px — not used by drawBackground() (see its own comment), kept as a general "how far have we visually travelled" counter for any future parallax layer
    altitudeMeters: 0,
    fuel: CONFIG.fuel.max,
    obstacles: [],
    pickups: [],
    nextPickupAt: 0,
    zoneSpawnTimers: {},   // zone name -> ms-until-next-spawn, ticked down per frame
    invulnerableUntil: 0,
    hitFlashUntil: 0,
    keyLeft: false,
    keyRight: false,
    lastFrameAt: 0,
    flameFlicker: 0
  };

  function altitudeFraction() {
    return Math.min(1, state.altitudeMeters / CONFIG.level1.moonAltitudeMeters);
  }
  function difficultyT() { return altitudeFraction(); } // 0 at launch, 1 at Moon — shared ramp for speed/spawn-rate scaling

  // ================= screen switching =================
  const dpad = document.getElementById('sb-dpad');
  function showScreen(key) {
    Object.values(screens).forEach((el) => { if (el) el.classList.add('hidden'); });
    if (key && screens[key]) screens[key].classList.remove('hidden');
    const overlayShowing = key === 'MENU' || key === 'GAMEOVER' || key === 'COMPLETE';
    hud.classList.toggle('hidden', overlayShowing);
    // The on-screen d-pad is only useful (and should only be visible)
    // while actually flying — otherwise its buttons peek out from
    // behind/around the menu and game-over/complete overlays, which
    // sit centered over the stage rather than covering it edge-to-edge.
    if (dpad) dpad.classList.toggle('hidden', overlayShowing);
  }

  // ================= reset / start =================
  function resetRun() {
    state.rocketX = DESIGN_W / 2;
    state.rocketY = CONFIG.rocket.padScreenY;
    state.scrollSpeed = 0;
    state.scrollOffset = 0;
    state.altitudeMeters = 0;
    state.fuel = CONFIG.fuel.max;
    state.obstacles = [];
    state.pickups = [];
    state.nextPickupAt = randRange(CONFIG.fuel.pickupSpawnIntervalMinMs, CONFIG.fuel.pickupSpawnIntervalMaxMs) * CONFIG.fuel.pickupSpawnRateMultiplier;
    state.zoneSpawnTimers = {};
    CONFIG.obstacles.zones.forEach((z) => {
      state.zoneSpawnTimers[z.name] = randRange(z.spawnIntervalMinMs, z.spawnIntervalMaxMs) * CONFIG.obstacles.spawnRateMultiplier;
    });
    state.invulnerableUntil = 0;
    state.hitFlashUntil = 0;
    updateHud();
  }

  function startLaunch() {
    resetRun();
    state.phase = STATE.LIFTOFF;
    state.liftoffStartAt = performance.now();
    showScreen(null);
  }

  function retry() { startLaunch(); }
  function backToMenu() { state.phase = STATE.MENU; showScreen('MENU'); }

  btnStartLaunch.addEventListener('click', startLaunch);
  btnRetry.addEventListener('click', retry);
  btnBackToMenuGameover.addEventListener('click', backToMenu);
  btnContinueComplete.addEventListener('click', backToMenu);

  // ================= input =================
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { state.keyLeft = true; e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { state.keyRight = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') state.keyLeft = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') state.keyRight = false;
  });
  // Touch/click d-pad, shown only on narrow viewports (see CSS) — mirrors
  // games/space-snake/index.html's on-screen control pattern.
  function wireHoldButton(el, onDown, onUp) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('pointercancel', onUp);
  }
  wireHoldButton(btnLeft, () => { state.keyLeft = true; }, () => { state.keyLeft = false; });
  wireHoldButton(btnRight, () => { state.keyRight = true; }, () => { state.keyRight = false; });

  function randRange(min, max) { return min + Math.random() * (max - min); }

  // ================= HUD =================
  function updateHud() {
    const alt = Math.round(state.altitudeMeters);
    altitudeValueEl.textContent = alt.toLocaleString() + ' m';
    const pct = Math.max(0, Math.min(100, (state.fuel / CONFIG.fuel.max) * 100));
    fuelFillEl.style.width = pct + '%';
    fuelFillEl.classList.toggle('low', pct <= 25);
    fuelPctEl.textContent = Math.round(pct) + '%';
  }

  // ================= background: fixed virtual vertical strip =================
  // Architecture (replacing an earlier stage-index-lookup version that
  // could visibly "snap" right as the index advanced): every one of the
  // 10 scenes gets a PERMANENT world-space Y coordinate, assigned once
  // here and never recomputed, reassigned, or reset for the rest of the
  // run. The only thing that changes per frame is state.scrollOffset (a
  // single scalar, "worldOffsetY") — every scene's screen position is
  // just `scene.worldY + worldOffsetY`. There is no "current stage
  // index" anywhere in this file for backgrounds; nothing about a
  // scene's identity or position ever depends on which one is nominally
  // "active" right now, so there is no index-advance moment for
  // anything to snap around.
  //
  // scene[i].worldY = -(DESIGN_H - overlapPx) * i — each successive
  // scene sits exactly `spacing` px above the previous one (spacing <
  // DESIGN_H, so consecutive scenes overlap by `overlapPx`). Scene 0
  // (ground) starts at worldY=0, i.e. already in place when
  // worldOffsetY=0 (the moment liftoff begins).
  function buildBackgroundScenes(stages, images) {
    const bg = CONFIG.background;
    const spacing = DESIGN_H - bg.overlapPx;
    return stages.map((stage, i) => ({
      image: stage.image,
      fallbackColor: stage.fallbackColor,
      worldY: -spacing * i,
      img: images[i],
      // Pre-baked once per scene (never per frame): top edge feathered
      // in (smoothstep 0->1) unless this is the very first scene (its
      // top borders nothing), bottom edge feathered out (1->0) unless
      // this is the very last scene (its bottom borders nothing). The
      // fade span exactly matches overlapPx, so it lines up pixel-for-
      // pixel with the actual physical overlap between neighbours —
      // drawn in ascending world order (see drawBackground()), a scene's
      // fade-in top always lands exactly across the previous scene's
      // fade-out bottom, nothing more, nothing less.
      feathered: buildFeatheredCanvas(images[i], bg.overlapPx, i > 0, i < stages.length - 1)
    }));
  }

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function buildFeatheredCanvas(img, fade, fadeTop, fadeBottom) {
    if (!img) return null;
    const off = document.createElement('canvas');
    off.width = DESIGN_W;
    off.height = DESIGN_H;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, DESIGN_W, DESIGN_H);
    if (!fadeTop && !fadeBottom) return off; // scene 0's top / last scene's bottom: nothing to blend into, stays fully opaque
    // Built pixel-row-by-gradient-stop rather than a single 3-stop
    // gradient so the alpha curve can use smoothstep easing (spec:
    // "use smoothstep/easing instead of a perfectly linear fade if that
    // looks better") rather than a flat linear ramp.
    const grad = octx.createLinearGradient(0, 0, 0, DESIGN_H);
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const yFrac = s / steps;
      const y = yFrac * DESIGN_H;
      let a = 1;
      if (fadeTop && y < fade) a = Math.min(a, smoothstep(y / fade));
      if (fadeBottom && y > DESIGN_H - fade) a = Math.min(a, smoothstep((DESIGN_H - y) / fade));
      grad.addColorStop(yFrac, 'rgba(0,0,0,' + a + ')');
    }
    octx.globalCompositeOperation = 'destination-in';
    octx.fillStyle = grad;
    octx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    return off;
  }

  // worldOffsetY, clamped so the LAST scene settles at screenY=0 and
  // holds there once reached (rather than continuing to scroll the Moon
  // itself off the bottom of the screen past that point) — the spec's
  // "once the Moon begins entering... it must never disappear" — capping
  // the DRIVING offset, not the scene's own worldY, means the Moon's
  // trajectory is still the exact same monotonic downward slide the
  // whole way, it simply stops advancing once arrived rather than being
  // clamped/snapped into place.
  function worldOffsetY() {
    return Math.min(state.scrollOffset, CONFIG.background.totalTravelPx);
  }

  // Draws every scene whose screen-space box could possibly overlap the
  // visible canvas, in ascending world order (scene 0 first) — later
  // (higher, more-recently-revealed) scenes are drawn on top, so a
  // scene's own top-edge fade-in always composites correctly over the
  // previous scene's bottom-edge fade-out beneath it, purely through
  // normal alpha blending. No scene is ever skipped, recycled, or drawn
  // more than once per frame; none of their positions are touched here —
  // this function only READS scene.worldY, it never writes it.
  function drawBackground() {
    const offsetY = worldOffsetY();
    let anyDrawn = false;
    for (let i = 0; i < BACKGROUND_SCENES.length; i++) {
      const scene = BACKGROUND_SCENES[i];
      const y = scene.worldY + offsetY;
      if (y > DESIGN_H || y + DESIGN_H < 0) continue; // fully off-screen this frame — cheap skip, not a recycle
      if (!anyDrawn) {
        // Fallback fill, using the FIRST visible scene's own tone (never
        // a generic black) — only ever shows through in the extremely
        // unlikely case a scene's image failed to decode, since all 10
        // are preloaded before START LAUNCH even enables.
        ctx.fillStyle = scene.fallbackColor || '#04070f';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
        anyDrawn = true;
      }
      const drawH = DESIGN_H + CONFIG.background.safetyOverlapPx;
      const source = scene.feathered || scene.img;
      if (source) ctx.drawImage(source, 0, y, DESIGN_W, drawH);
    }
    if (!anyDrawn) { ctx.fillStyle = '#04070f'; ctx.fillRect(0, 0, DESIGN_W, DESIGN_H); }
  }

  // ================= rocket + flame =================
  function drawRocket() {
    const r = CONFIG.rocket;
    const x = state.rocketX, y = state.rocketY;
    const w = r.width, h = r.height;
    const flying = state.phase === STATE.LIFTOFF || state.phase === STATE.FLYING;
    const hitFlash = performance.now() < state.hitFlashUntil;

    ctx.save();
    ctx.translate(x, y);

    // ---- exhaust flame (drawn first, so it sits behind/below the hull) ----
    if (flying && state.scrollSpeed > 4) {
      const flicker = 0.75 + 0.25 * Math.sin(state.flameFlicker) + 0.15 * Math.random();
      const flameLen = (h * 0.65) * flicker * Math.min(1, state.scrollSpeed / CONFIG.scroll.cruiseSpeedPerSec + 0.3);
      const grad = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.42 + flameLen);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.35, 'rgba(255,196,64,0.95)');
      grad.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, h * 0.42);
      ctx.quadraticCurveTo(0, h * 0.42 + flameLen * 0.7, 0, h * 0.42 + flameLen);
      ctx.quadraticCurveTo(0, h * 0.42 + flameLen * 0.7, w * 0.22, h * 0.42);
      ctx.closePath();
      ctx.fill();
    }

    // ---- hull ----
    ctx.fillStyle = hitFlash ? '#ff5a5a' : '#e7ecf5';
    ctx.strokeStyle = '#8894ab';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.5);                                   // nose tip
    ctx.quadraticCurveTo(w * 0.5, -h * 0.15, w * 0.36, h * 0.28);
    ctx.lineTo(w * 0.36, h * 0.42);
    ctx.lineTo(-w * 0.36, h * 0.42);
    ctx.lineTo(-w * 0.36, h * 0.28);
    ctx.quadraticCurveTo(-w * 0.5, -h * 0.15, 0, -h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // nose cone accent
    ctx.fillStyle = hitFlash ? '#c73b3b' : '#e2504a';
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.5);
    ctx.quadraticCurveTo(w * 0.28, -h * 0.2, w * 0.2, -h * 0.02);
    ctx.lineTo(-w * 0.2, -h * 0.02);
    ctx.quadraticCurveTo(-w * 0.28, -h * 0.2, 0, -h * 0.5);
    ctx.closePath();
    ctx.fill();

    // window
    ctx.fillStyle = '#7fd8ff';
    ctx.strokeStyle = '#3d6f8a';
    ctx.beginPath();
    ctx.arc(0, h * 0.02, w * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // fins
    ctx.fillStyle = hitFlash ? '#c73b3b' : '#c62f3a';
    ctx.beginPath();
    ctx.moveTo(-w * 0.36, h * 0.16);
    ctx.lineTo(-w * 0.62, h * 0.42);
    ctx.lineTo(-w * 0.36, h * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.36, h * 0.16);
    ctx.lineTo(w * 0.62, h * 0.42);
    ctx.lineTo(w * 0.36, h * 0.42);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ================= obstacles =================
  // One small draw routine per type, keyed by name — see CONFIG.obstacles
  // .zones for which types are eligible to spawn at which altitude. Each
  // receives (ctx, obstacle, nowMs) and draws centred on (0,0) at its own
  // configured width/height (already translated by the caller).
  const OBSTACLE_DRAWERS = {
    bird(c, o, now) {
      const flap = Math.sin(now / 90 + o.seed) * 0.5;
      c.strokeStyle = '#2b2b2b'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-18, 0); c.quadraticCurveTo(-6, -10 - flap * 14, 0, 0);
      c.quadraticCurveTo(6, -10 + flap * 14, 18, 0);
      c.stroke();
    },
    helicopter(c) {
      c.fillStyle = '#4a5568';
      c.beginPath(); c.ellipse(0, 4, 22, 12, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(-2, -2, 34, 5); // tail boom
      c.fillStyle = '#7fd8ff'; c.beginPath(); c.arc(-8, 2, 7, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#1c222c'; c.lineWidth = 2;
      const spin = (performance.now() / 30) % Math.PI;
      c.save(); c.translate(0, -12); c.rotate(spin);
      c.beginPath(); c.moveTo(-30, 0); c.lineTo(30, 0); c.stroke();
      c.restore();
    },
    plane(c) {
      c.fillStyle = '#d8dde6';
      c.beginPath();
      c.moveTo(0, -26); c.lineTo(8, 10); c.lineTo(0, 4); c.lineTo(-8, 10);
      c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(-28, 6); c.lineTo(0, -4); c.lineTo(28, 6); c.lineTo(0, 12);
      c.closePath(); c.fill();
    },
    stormcloud(c, o, now) {
      c.fillStyle = 'rgba(70,72,92,0.92)';
      [[-16, 0, 16], [0, -8, 20], [16, 0, 15], [-4, 6, 14]].forEach(([dx, dy, r]) => {
        c.beginPath(); c.arc(dx, dy, r, 0, Math.PI * 2); c.fill();
      });
      if (Math.sin(now / 140 + o.seed) > 0.92) {
        c.strokeStyle = '#ffe98a'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(-2, 8); c.lineTo(4, 18); c.lineTo(-2, 20); c.lineTo(6, 32); c.stroke();
      }
    },
    satellite(c) {
      c.fillStyle = '#b9c2cf'; c.fillRect(-9, -9, 18, 18);
      c.fillStyle = '#3d6f8a';
      c.fillRect(-32, -6, 20, 12);
      c.fillRect(12, -6, 20, 12);
      c.strokeStyle = '#6c7684'; c.lineWidth = 2;
      c.strokeRect(-32, -6, 20, 12); c.strokeRect(12, -6, 20, 12);
      c.beginPath(); c.moveTo(-9, 0); c.lineTo(-12, 0); c.moveTo(9, 0); c.lineTo(12, 0); c.stroke();
    },
    debris(c) {
      c.fillStyle = '#8a8f9a';
      c.beginPath();
      c.moveTo(-14, -4); c.lineTo(-2, -16); c.lineTo(12, -8); c.lineTo(16, 6); c.lineTo(2, 16); c.lineTo(-12, 10);
      c.closePath(); c.fill();
    },
    meteor(c, o, now) {
      const grad = c.createRadialGradient(0, 0, 2, 0, 0, 22);
      grad.addColorStop(0, 'rgba(255,180,90,0.9)');
      grad.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = grad; c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#5c4433';
      c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill();
    },
    rock(c) {
      c.fillStyle = '#726a63';
      c.beginPath();
      c.moveTo(-13, 6); c.lineTo(-6, -13); c.lineTo(9, -10); c.lineTo(13, 8); c.lineTo(0, 14);
      c.closePath(); c.fill();
    }
  };

  function currentObstacleZone() {
    const frac = altitudeFraction();
    const zones = CONFIG.obstacles.zones;
    let zone = zones[0];
    for (let i = 0; i < zones.length; i++) { if (frac >= zones[i].start) zone = zones[i]; }
    return zone;
  }

  function spawnObstacle(zone) {
    const cfg = CONFIG.obstacles;
    const type = zone.types[Math.floor(Math.random() * zone.types.length)];
    const t = difficultyT();
    const speed = zone.speedPerSec * (1 + t * (CONFIG.difficulty.maxSpeedMultiplier - 1));
    state.obstacles.push({
      type,
      x: randRange(cfg.width, DESIGN_W - cfg.width),
      y: -cfg.height,
      speed,
      seed: Math.random() * 1000
    });
  }

  function spawnPickup() {
    const cfg = CONFIG.fuel;
    state.pickups.push({
      x: randRange(cfg.pickupWidth, DESIGN_W - cfg.pickupWidth),
      y: -cfg.pickupHeight,
      speed: cfg.pickupFallSpeedPerSec,
      sway: Math.random() * Math.PI * 2
    });
  }

  function drawFuelPickup(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    // parachute
    ctx.strokeStyle = '#e2504a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -26, 20, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-20, -26); ctx.lineTo(-9, -6);
    ctx.moveTo(0, -46); ctx.lineTo(0, -6);
    ctx.moveTo(20, -26); ctx.lineTo(9, -6);
    ctx.stroke();
    // can
    ctx.fillStyle = '#ffcf4d';
    ctx.fillRect(-13, -6, 26, 32);
    ctx.strokeStyle = '#a87a00'; ctx.lineWidth = 2;
    ctx.strokeRect(-13, -6, 26, 32);
    ctx.fillStyle = '#a87a00';
    ctx.fillRect(-13, 6, 26, 6);
    ctx.fillStyle = '#3a2a00';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('FUEL', 0, 3);
    ctx.restore();
  }

  // ================= collisions =================
  function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy <= r * r;
  }

  function checkCollisions() {
    const col = CONFIG.collision;
    const rocketR = col.rocketRadius;

    // fuel pickups
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const p = state.pickups[i];
      const pr = CONFIG.fuel.pickupWidth * col.pickupRadiusFactor;
      if (circleHit(state.rocketX, state.rocketY, rocketR, p.x, p.y, pr)) {
        state.fuel = Math.min(CONFIG.fuel.max, state.fuel + CONFIG.fuel.pickupRestoreAmount);
        state.pickups.splice(i, 1);
      }
    }

    // obstacles
    if (performance.now() < state.invulnerableUntil) return;
    const or_ = CONFIG.obstacles.width * col.obstacleRadiusFactor;
    for (let i = 0; i < state.obstacles.length; i++) {
      const o = state.obstacles[i];
      if (circleHit(state.rocketX, state.rocketY, rocketR, o.x, o.y, or_)) {
        onObstacleHit();
        break;
      }
    }
  }

  function onObstacleHit() {
    state.hitFlashUntil = performance.now() + 220;
    if (CONFIG.obstacles.collisionEndsRun) {
      // Not the default — kept as an easy on/off switch for a future
      // harder difficulty mode.
      finishRun('crash');
      return;
    }
    // Default path: a hit costs fuel (OBSTACLE_DAMAGE) rather than
    // ending the run outright. If this drains the tank to 0, update()'s
    // `if (state.fuel <= 0) finishRun('fuel')` check (which runs right
    // after checkCollisions() every frame) catches it the same frame —
    // the run still ends, just correctly attributed to running out of
    // fuel rather than a generic "crash".
    state.invulnerableUntil = performance.now() + CONFIG.obstacles.collisionInvulnerabilityMs;
    state.fuel = Math.max(0, state.fuel - CONFIG.obstacles.collisionFuelPenalty);
  }

  // ================= run end =================
  const GAMEOVER_HEADINGS = { fuel: 'OUT OF FUEL', crash: 'DESTROYED' };
  function finishRun(reason) {
    if (reason === 'moon') {
      state.phase = STATE.COMPLETE;
      completeAltitudeEl.textContent = Math.round(state.altitudeMeters).toLocaleString() + ' m';
      showScreen('COMPLETE');
    } else {
      state.phase = STATE.GAMEOVER;
      if (gameoverHeadingEl) gameoverHeadingEl.textContent = GAMEOVER_HEADINGS[reason] || GAMEOVER_HEADINGS.fuel;
      gameoverAltitudeEl.textContent = Math.round(state.altitudeMeters).toLocaleString() + ' m';
      showScreen('GAMEOVER');
    }
    // TODO(future): this is where a completed-run RPC call belongs, once
    // Starbound is wired into the site's XP/stats system — e.g.
    //   window.QZAuth.client.rpc('record_game_result', { p_game_key: GAME_KEY, p_score: Math.round(state.altitudeMeters) })
    //   window.QZAuth.client.rpc('award_xp', { p_game_key: GAME_KEY, p_xp_to_add: ... })
    // matching games/space-snake/index.html's awardSpaceSnakeXp() and
    // games/anagram-quest/anagram-quest.js's saveGameResult()/
    // awardIntelligenceXp(). Deliberately not called yet, per spec.
  }

  // ================= update =================
  function update(dt, now) {
    // rampT: 0 at the very start of liftoff -> 1 once at cruise. Drives
    // every "how much of full speed are we at" quantity (flame
    // intensity, ascent rate, AND background scroll rate) from one
    // single eased curve, so they all spool up together during liftoff
    // instead of each computing its own inconsistent ratio.
    let rampT = 1;
    if (state.phase === STATE.LIFTOFF) {
      const t = Math.min(1, (now - state.liftoffStartAt) / CONFIG.rocket.liftoffDurationMs);
      rampT = 1 - Math.pow(1 - t, 3);
      const targetY = DESIGN_H * CONFIG.rocket.screenYFraction;
      state.rocketY = CONFIG.rocket.padScreenY + (targetY - CONFIG.rocket.padScreenY) * rampT;
      if (t >= 1) state.phase = STATE.FLYING;
    }
    // state.scrollSpeed stays tied to scroll.cruiseSpeedPerSec — it only
    // feeds the exhaust-flame intensity (drawRocket()) now, NOT the
    // background (see worldOffsetY(), which reads state.scrollOffset,
    // accumulated below straight from background.scrollSpeedPerSec — the
    // actual "BACKGROUND_SCROLL_SPEED" — so the two stay independently
    // tunable as intended).
    if (state.phase === STATE.LIFTOFF || state.phase === STATE.FLYING) {
      state.scrollSpeed = CONFIG.scroll.cruiseSpeedPerSec * rampT;
    }

    if (state.phase === STATE.LIFTOFF || state.phase === STATE.FLYING) {
      // horizontal movement, clamped to the playable area
      const r = CONFIG.rocket;
      let vx = 0;
      if (state.keyLeft) vx -= r.horizontalSpeedPerSec;
      if (state.keyRight) vx += r.horizontalSpeedPerSec;
      state.rocketX += vx * dt;
      const minX = r.edgeMarginPx, maxX = DESIGN_W - r.edgeMarginPx;
      state.rocketX = Math.max(minX, Math.min(maxX, state.rocketX));

      // The two clocks the spec asks for, kept genuinely independent:
      //   backgroundScroll += BACKGROUND_SCROLL_SPEED * deltaTime
      //   altitude          += ASCENT_SPEED * deltaTime
      // both ramped by the SAME liftoff curve (rampT) so they spool up
      // together, but each reads its own config speed — changing one
      // does not silently change the other.
      state.scrollOffset += CONFIG.background.scrollSpeedPerSec * rampT * dt;
      state.altitudeMeters += CONFIG.altitude.metersPerSecond * rampT * dt;
      state.flameFlicker += dt * 18;
    }

    if (state.phase === STATE.FLYING) {
      state.fuel = Math.max(0, state.fuel - CONFIG.fuel.drainPerSecond * dt);

      // obstacle spawning, per current altitude zone
      const zone = currentObstacleZone();
      state.zoneSpawnTimers[zone.name] -= dt * 1000;
      if (state.zoneSpawnTimers[zone.name] <= 0) {
        spawnObstacle(zone);
        const t = difficultyT();
        const mul = 1 - t * (1 - CONFIG.difficulty.minSpawnIntervalMultiplier);
        state.zoneSpawnTimers[zone.name] = randRange(zone.spawnIntervalMinMs, zone.spawnIntervalMaxMs) * mul * CONFIG.obstacles.spawnRateMultiplier;
      }

      // fuel pickup spawning
      state.nextPickupAt -= dt * 1000;
      if (state.nextPickupAt <= 0) {
        spawnPickup();
        state.nextPickupAt = randRange(CONFIG.fuel.pickupSpawnIntervalMinMs, CONFIG.fuel.pickupSpawnIntervalMaxMs) * CONFIG.fuel.pickupSpawnRateMultiplier;
      }

      // advance + cull obstacles/pickups
      for (let i = state.obstacles.length - 1; i >= 0; i--) {
        const o = state.obstacles[i];
        o.y += o.speed * dt;
        if (o.y > DESIGN_H + CONFIG.obstacles.height) state.obstacles.splice(i, 1);
      }
      for (let i = state.pickups.length - 1; i >= 0; i--) {
        const p = state.pickups[i];
        p.y += p.speed * dt;
        if (p.y > DESIGN_H + CONFIG.fuel.pickupHeight) state.pickups.splice(i, 1);
      }

      checkCollisions();
      updateHud();

      if (state.fuel <= 0) finishRun('fuel');
      else if (state.altitudeMeters >= CONFIG.level1.moonAltitudeMeters) finishRun('moon');
    }
  }

  // ================= draw =================
  function draw(now) {
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
    if (!assetsReady) return;
    drawBackground();

    if (state.phase === STATE.FLYING || state.phase === STATE.LIFTOFF) {
      // OBSTACLE_DRAWERS were all hand-authored assuming a
      // referenceSize px bounding box — scaling the canvas by
      // (obstacles.width / referenceSize) before invoking one grows the
      // ACTUAL drawn artwork (not just the hit box) whenever
      // obstacles.width/height changes in config, with no per-drawer
      // edits needed.
      const obstacleArtScale = CONFIG.obstacles.width / CONFIG.obstacles.referenceSize;
      state.obstacles.forEach((o) => {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.scale(obstacleArtScale, obstacleArtScale);
        (OBSTACLE_DRAWERS[o.type] || OBSTACLE_DRAWERS.rock)(ctx, o, now);
        ctx.restore();
      });
      state.pickups.forEach(drawFuelPickup);
      drawRocket();
    }
  }

  // ================= main loop =================
  function loop(now) {
    requestAnimationFrame(loop);
    // Clamp to 250ms (matching games/space-snake/index.html's own
    // gameLoop() clamp) — long enough that a genuinely slow frame (a
    // real low-end device, or this environment's automated preview
    // browser, both of which can render well under 20fps) still
    // advances state at the ACTUAL elapsed real time instead of being
    // capped into slow motion, but short enough that a real multi-second
    // tab-switch stall doesn't suddenly dump minutes of altitude/fuel
    // drain into one frame the moment the tab regains focus.
    const dt = Math.min(0.25, (now - (state.lastFrameAt || now)) / 1000);
    state.lastFrameAt = now;
    update(dt, now);
    draw(now);
  }

  // ================= boot =================
  // START LAUNCH stays disabled until every Level 1 background is
  // actually decoded and ready — fetching the NEXT stage's image only
  // once the player reaches its transition point is exactly the kind of
  // "load during gameplay" stutter risk that produces a visible glitch,
  // so preloadAssets() (which fetches all 10 stages up front) is
  // guaranteed to finish before a run can begin at all, not just before
  // the loop starts.
  async function init() {
    resizeCanvas();
    showScreen('MENU');
    btnStartLaunch.disabled = true;
    btnStartLaunch.textContent = 'LOADING…';
    await preloadAssets();
    btnStartLaunch.disabled = false;
    btnStartLaunch.textContent = 'START LAUNCH';
    requestAnimationFrame(loop);
  }
  init();
})();
