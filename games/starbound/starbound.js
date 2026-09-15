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
//     CONFIG.obstacles.zones), and adding a new hand-drawn hazard later
//     only means adding a zone/type entry plus one entry in
//     OBSTACLE_DRAWERS below — no other code needs to change. The two
//     bird types (sparrow, pigeon, eagle), the stormcloud type, the 4
//     satellite types, and the 4 meteor-wave types are the exceptions:
//     real animated sprites rather than hand-drawn canvas shapes, each
//     spawned through their own trio of functions (trySpawnBirdObstacle()/
//     updateBirdObstacle()/drawBirdObstacle(); trySpawnStormCloud()/
//     updateStormCloud()/drawStormCloud(); trySpawnSatellite()/
//     updateSatellite()/drawSatellite(); trySpawnMeteor()/
//     updateMeteorObstacle()/drawMeteorObstacle()) instead of the
//     zone-timer path other types use — see CONFIG.obstacles.birds,
//     .stormCloud, .satelliteBelt, and .meteorWave.
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
  // Loaded bird sprites, keyed the same way as CONFIG.obstacles.birds:
  // BIRD_IMAGES.sparrow.wingsUp / .wingsDown / .dive, BIRD_IMAGES.pigeon.*
  // — all six are preloaded up front alongside the backgrounds so the
  // first on-screen bird never causes a decode-flash mid-run.
  let BIRD_IMAGES = {};
  // STORM_IMAGES.normal / .charged (the cloud body) and .lightning[i]
  // (the 4 bolt sprite variants) — see CONFIG.obstacles.stormCloud.
  let STORM_IMAGES = { normal: null, charged: null, lightning: [] };
  // SATELLITE_IMAGES.wide / .thinFast / .spinner / .diagonal — see
  // CONFIG.obstacles.satelliteBelt.
  let SATELLITE_IMAGES = {};
  // METEOR_IMAGES.normal / .fire / .crackedStage1 / .crackedStage2 /
  // .fragments[i] — see CONFIG.obstacles.meteorWave.
  let METEOR_IMAGES = { fragments: [] };
  // The fuel pickup's real sprite (parachute + jerry can) — see
  // CONFIG.fuel.image.
  let FUEL_IMAGE = null;
  async function preloadAssets() {
    const stages = CONFIG.background.stages;
    const birdCfg = CONFIG.obstacles.birds;
    const birdTypes = Object.keys(birdCfg).filter((k) => birdCfg[k] && birdCfg[k].images);
    const stormCfg = CONFIG.obstacles.stormCloud;
    const satCfg = CONFIG.obstacles.satelliteBelt;
    const satTypes = Object.keys(satCfg.types);
    const metCfg = CONFIG.obstacles.meteorWave;
    const [loadedStages, loadedBirdSets, stormNormal, stormCharged, stormLightning, loadedSatImages,
      metNormal, metFire, metCracked1, metCracked2, metFragments, fuelImg] = await Promise.all([
      Promise.all(stages.map((s) => loadImage(s.image))),
      Promise.all(birdTypes.map((type) => {
        const images = birdCfg[type].images;
        const poses = Object.keys(images);
        return Promise.all(poses.map((pose) => loadImage(images[pose])))
          .then((imgs) => poses.reduce((acc, pose, i) => { acc[pose] = imgs[i]; return acc; }, {}));
      })),
      loadImage(stormCfg.images.normal),
      loadImage(stormCfg.images.charged),
      Promise.all(stormCfg.lightningImages.map((src) => loadImage(src))),
      Promise.all(satTypes.map((type) => loadImage(satCfg.types[type].image))),
      loadImage(metCfg.images.normal),
      loadImage(metCfg.images.fire),
      loadImage(metCfg.images.crackedStage1),
      loadImage(metCfg.images.crackedStage2),
      Promise.all(metCfg.images.fragments.map((src) => loadImage(src))),
      loadImage(CONFIG.fuel.image)
    ]);
    BACKGROUND_SCENES = buildBackgroundScenes(stages, loadedStages);
    BIRD_IMAGES = birdTypes.reduce((acc, type, i) => { acc[type] = loadedBirdSets[i]; return acc; }, {});
    STORM_IMAGES = { normal: stormNormal, charged: stormCharged, lightning: stormLightning };
    SATELLITE_IMAGES = satTypes.reduce((acc, type, i) => { acc[type] = loadedSatImages[i]; return acc; }, {});
    METEOR_IMAGES = { normal: metNormal, fire: metFire, crackedStage1: metCracked1, crackedStage2: metCracked2, fragments: metFragments };
    FUEL_IMAGE = fuelImg;
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
  // Coarse-pointer (touch) devices are treated as "mobile" — the
  // unclamped devicePixelRatio below could be 3+ on a phone, meaning a
  // 9x larger canvas backing store than a capped 1x, which was the
  // single biggest cause of mobile jank here (busier scene than Pup N
  // Away: obstacles, birds, particles, all redrawn every frame at that
  // resolution).
  const isMobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 2);
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
    satelliteSpawnQueue: [], // pending pattern entries — {delayMs, x, type, speedMultiplier}, see update()
    nextSatellitePatternAllowedAt: 0,
    satelliteSpawnTimerMs: 0, // independent of zoneSpawnTimers — see the Satellite Belt block in update()
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
    state.satelliteSpawnQueue = [];
    state.nextSatellitePatternAllowedAt = 0;
    state.satelliteSpawnTimerMs = randRange(300, 900);
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
  // scene[i].worldY — cumulative sum of each transition's own spacing
  // (one screen-height minus THAT transition's overlap), rather than a
  // flat `-spacing*i` multiplication, since one transition can now use a
  // larger-than-default overlap (see CONFIG.background.transitionOverrides
  // — currently just the deep-space -> Moon-approach seam) without
  // affecting any other scene's position. Scene 0 (ground) starts at
  // worldY=0, i.e. already in place when worldOffsetY=0 (the moment
  // liftoff begins).
  function overlapForTransition(i) {
    const override = CONFIG.background.transitionOverrides[i];
    return (override && override.overlapPx) || CONFIG.background.overlapPx;
  }

  function buildBackgroundScenes(stages, images) {
    const scenes = [];
    let y = 0;
    for (let i = 0; i < stages.length; i++) {
      scenes.push({ image: stages[i].image, fallbackColor: stages[i].fallbackColor, worldY: y, img: images[i] });
      if (i < stages.length - 1) y -= DESIGN_H - overlapForTransition(i);
    }
    // Feathering is a second pass (after every worldY is known). Later
    // scenes have more negative worldY, so at any given scroll offset a
    // higher-index scene sits ABOVE a lower-index one on screen — the
    // shared overlap between scene i and scene i+1 physically lands at
    // scene i's TOP edge and scene (i+1)'s BOTTOM edge. So a scene's TOP
    // fade width comes from the transition BELOW its own index
    // (overlapForTransition(i), connecting it to the scene above it) and
    // its BOTTOM fade width comes from the transition ABOVE its own index
    // (overlapForTransition(i-1), connecting it to the scene below it).
    // The two can differ (only true today for scenes 8 and 9, either side
    // of the widened deep-space seam). Pre-baked once per scene here,
    // never per frame. The fade span always exactly matches the REAL
    // physical overlap for that specific pair, so it lines up
    // pixel-for-pixel with the actual overlap between neighbours
    // regardless of which transition uses the default width or an
    // override.
    scenes.forEach((scene, i) => {
      const topFade = i < scenes.length - 1 ? overlapForTransition(i) : 0;
      const bottomFade = i > 0 ? overlapForTransition(i - 1) : 0;
      // topFadeDelayFraction (see CONFIG.background.transitionOverrides,
      // today only the bg-06 -> bg-07 "stars over the globe" seam) holds
      // this scene's OWN top edge at alpha 0 for the first fraction of
      // its top-fade zone instead of ramping in immediately — used only
      // where the incoming scene's content (stars) would otherwise
      // appear layered over the outgoing scene's still-mostly-opaque
      // content (the globe) rather than genuinely "above" it.
      const topOverride = CONFIG.background.transitionOverrides[i];
      const topDelayFraction = (topOverride && topOverride.topFadeDelayFraction) || 0;
      scene.feathered = buildFeatheredCanvas(scene.img, topFade, bottomFade, topDelayFraction);
    });
    return scenes;
  }

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function buildFeatheredCanvas(img, topFade, bottomFade, topDelayFraction) {
    if (!img) return null;
    const off = document.createElement('canvas');
    off.width = DESIGN_W;
    off.height = DESIGN_H;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, DESIGN_W, DESIGN_H);
    if (!topFade && !bottomFade) return off; // scene 0's top / last scene's bottom: nothing to blend into, stays fully opaque
    // Built pixel-row-by-gradient-stop rather than a single 3-stop
    // gradient so the alpha curve can use smoothstep easing rather than
    // a flat linear ramp, and so top/bottom can use different widths.
    const grad = octx.createLinearGradient(0, 0, 0, DESIGN_H);
    const steps = 32;
    for (let s = 0; s <= steps; s++) {
      const yFrac = s / steps;
      const y = yFrac * DESIGN_H;
      let a = 1;
      if (topFade && y < topFade) {
        const t = y / topFade;
        // Delayed ramp: stay at 0 through the first topDelayFraction of
        // the zone, then smoothstep over the remainder — see
        // topFadeDelayFraction above for why (this scene's content
        // shouldn't start appearing until the scene it's fading in over
        // has mostly faded out, not at the very first pixel of overlap).
        const adjustedT = topDelayFraction ? Math.max(0, (t - topDelayFraction) / (1 - topDelayFraction)) : t;
        a = Math.min(a, smoothstep(adjustedT));
      }
      if (bottomFade && y > DESIGN_H - bottomFade) a = Math.min(a, smoothstep((DESIGN_H - y) / bottomFade));
      grad.addColorStop(yFrac, 'rgba(0,0,0,' + a + ')');
    }
    octx.globalCompositeOperation = 'destination-in';
    octx.fillStyle = grad;
    octx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    return off;
  }

  // A targeted fix for ONE transition (see CONFIG.background.
  // transitionOverrides): even with a wider alpha crossfade, two
  // starfields with noticeably different base brightness/exposure can
  // still read as "a line" where one ends and the other begins, because
  // straight alpha-blending two differently-exposed images doesn't
  // actually make the darker one's true colour appear gradually — it
  // just mixes two fixed colours. Layering an extra flat tint (matching
  // the darker scene's own dominant tone) across the SAME overlap zone,
  // eased in then back out (smoothstep hump, peaking at tintPeakAlpha in
  // the middle), gives the brightness an actual intermediate step to
  // pass through — bright -> tinted-toward-dark -> dark — instead of
  // jumping straight from one exposure to the other.
  function drawTransitionTintBridges(offsetY) {
    const overrides = CONFIG.background.transitionOverrides;
    Object.keys(overrides).forEach((key) => {
      const i = Number(key);
      const cfg = overrides[key];
      if (!cfg.tintColor) return;
      const lower = BACKGROUND_SCENES[i], upper = BACKGROUND_SCENES[i + 1];
      if (!lower || !upper) return;
      const overlap = cfg.overlapPx || CONFIG.background.overlapPx;
      // The overlap zone sits at the bottom `overlap` px of the upper
      // (incoming) scene's box, which is also the top `overlap` px of
      // the lower (outgoing) scene's box — both describe the same
      // screen-space band.
      const zoneTop = upper.worldY + offsetY + DESIGN_H - overlap;
      if (zoneTop > DESIGN_H || zoneTop + overlap < 0) return; // this zone isn't anywhere near the visible canvas right now
      const peak = cfg.tintPeakAlpha != null ? cfg.tintPeakAlpha : 0.4;
      const grad = ctx.createLinearGradient(0, zoneTop, 0, zoneTop + overlap);
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // Smoothstep hump: 0 at both edges of the zone, `peak` in the
        // middle — the bridge is only present WITHIN the overlap,
        // never bleeding into either scene's fully-own territory.
        const hump = 1 - Math.abs(t - 0.5) * 2;
        const a = peak * smoothstep(Math.max(0, hump));
        grad.addColorStop(t, cfg.tintColor.length === 7
          ? hexToRgba(cfg.tintColor, a)
          : cfg.tintColor);
      }
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, zoneTop, DESIGN_W, overlap);
      ctx.restore();
    });
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // A second, differently-shaped targeted fix (see CONFIG.background.
  // transitionOverrides[4].colorBridge — today only the bg-05 -> bg-06
  // seam): unlike the deep-space seam above, this one isn't a hard line,
  // it's a brightness SPIKE-THEN-DIP either side of the physical overlap
  // (bg-06's bright bottom crossfades into bg-05's dark top, then bg-05's
  // own dark-near-its-top colour reappears once bg-06 fades out) — a
  // single hump tint centered on the physical overlap wouldn't reach far
  // enough past it to catch the dip. This one is defined independently
  // of overlapPx/worldY entirely (pre/post-expand past the physical
  // zone, plus its own ramp width) — purely a render-time overlay, never
  // touching scene position — with a flat alpha PLATEAU (not a triangular
  // hump) spanning both the spike and the dip so each gets pulled toward
  // the same intermediate tone by roughly the same amount, rather than
  // the plateau's edges under-correcting whichever one sits off-centre.
  function drawColorMatchBridges(offsetY) {
    const overrides = CONFIG.background.transitionOverrides;
    Object.keys(overrides).forEach((key) => {
      const i = Number(key);
      const cfg = overrides[key].colorBridge;
      if (!cfg) return;
      const lower = BACKGROUND_SCENES[i], upper = BACKGROUND_SCENES[i + 1];
      if (!lower || !upper) return;
      const overlap = overlapForTransition(i);
      const zoneTop = upper.worldY + offsetY + DESIGN_H - overlap; // same physical overlap zone as the tint bridge
      const bandTop = zoneTop - cfg.preExpandPx;
      const bandBottom = zoneTop + overlap + cfg.postExpandPx;
      const bandHeight = bandBottom - bandTop;
      if (bandTop > DESIGN_H || bandBottom < 0) return; // nowhere near the visible canvas right now
      const ramp = cfg.rampPx;
      const grad = ctx.createLinearGradient(0, bandTop, 0, bandBottom);
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const y = t * bandHeight;
        // Ramp up over the first `ramp` px, flat at peakAlpha across the
        // middle plateau, ramp down over the last `ramp` px — the spike
        // and the dip both sit inside the plateau, at the SAME alpha.
        let a;
        if (y < ramp) a = smoothstep(y / ramp);
        else if (y > bandHeight - ramp) a = smoothstep((bandHeight - y) / ramp);
        else a = 1;
        grad.addColorStop(t, hexToRgba(cfg.color, cfg.peakAlpha * a));
      }
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, bandTop, DESIGN_W, bandHeight);
      ctx.restore();
    });
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
    drawTransitionTintBridges(offsetY);
    drawColorMatchBridges(offsetY);
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

  // ---- bird obstacles (sparrow, pigeon, eagle): real animated sprites ----
  // See CONFIG.obstacles.birds for the shared tuning (flap timing,
  // dive-chance/windup, per-type scale+speeds) and birds.difficultyBands
  // for the altitude-dependent type mix. Unlike a plain shared state
  // machine, the three types have genuinely different movement
  // identities — see updateBirdObstacle() for sparrow/eagle's flap ->
  // PERMANENT-dive shape vs. the pigeon's continuous strafe+track.
  function isBirdType(type) {
    return !!(CONFIG.obstacles.birds[type] && CONFIG.obstacles.birds[type].images);
  }

  function birdDrawSize(type) {
    const birds = CONFIG.obstacles.birds;
    return birds.baseSize * birds[type].scale;
  }

  // Total spawn-pressure currently on screen (sum of every active bird's
  // own `cost`) — see maxActiveObstaclePressure in config.
  function activeBirdPressure() {
    let sum = 0;
    for (const o of state.obstacles) if (isBirdType(o.type)) sum += o.pressureCost || 0;
    return sum;
  }

  // Which difficulty band applies at a given altitude fraction — same
  // "last band whose start <= frac" convention as currentObstacleZone().
  function currentBirdBand(frac) {
    const bands = CONFIG.obstacles.birds.difficultyBands;
    let band = bands[0];
    for (let i = 0; i < bands.length; i++) { if (frac >= bands[i].start) band = bands[i]; }
    return band;
  }

  // 0->1 progress through the WHOLE bird section specifically (altitude
  // 0 up to the `storm` zone's own start), independent of the global
  // difficultyT() ramp (which spans the entire climb to the Moon and so
  // barely moves within this much narrower range). Used to make
  // nosedives gradually more frequent as the player climbs through the
  // bird section itself — see SPARROW_DIVE_CHANCE/EAGLE_DIVE_CHANCE.
  function birdSectionProgress(frac) {
    const stormStart = CONFIG.obstacles.zones.find((z) => z.name === 'storm').start;
    return Math.max(0, Math.min(1, frac / stormStart));
  }

  // Weighted random pick among a band's { sparrow, pigeon, eagle }
  // weights (need not sum to 1; a zero-weight type simply can't be
  // picked in that band).
  function pickWeightedBirdType(band) {
    const entries = Object.entries(band.weights).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [type, w] of entries) {
      if (r < w) return type;
      r -= w;
    }
    return entries[entries.length - 1][0];
  }

  // Picks a spawn X that keeps at least minSpawnGapPx away from every
  // obstacle still near the top of the screen (see spawnGapZoneHeightPx)
  // — this, not the pressure budget, is what actually guarantees a
  // dodgeable route. Returns null (meaning "skip this spawn") if no
  // clear enough gap turns up in a handful of tries, rather than forcing
  // an unfair overlapping spawn.
  function findBirdSpawnX(drawSize) {
    const birds = CONFIG.obstacles.birds;
    const half = drawSize / 2;
    const minX = half, maxX = DESIGN_W - half;
    const nearTopX = state.obstacles
      .filter((o) => o.y < birds.spawnGapZoneHeightPx)
      .map((o) => o.x);
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = randRange(minX, maxX);
      if (nearTopX.every((ox) => Math.abs(ox - x) >= birds.minSpawnGapPx)) return x;
    }
    return null;
  }

  // The bird zone's spawn ATTEMPT (see update()'s spawn-timer block) —
  // every attempt can still end up spawning nothing at all, either
  // because the pressure budget is already full or because there's no
  // safely-spaced gap to spawn into right now. That's deliberate: it's
  // what keeps the screen from ever becoming an unavoidable wall.
  function trySpawnBirdObstacle() {
    const birds = CONFIG.obstacles.birds;
    const frac = altitudeFraction();
    const band = currentBirdBand(frac);
    const maxPressure = band.maxPressure != null ? band.maxPressure : birds.maxActiveObstaclePressure;
    const type = pickWeightedBirdType(band);
    const cfg = birds[type];
    if (activeBirdPressure() + cfg.cost > maxPressure) return; // budget already spent — skip, try again next interval
    const drawSize = birdDrawSize(type);
    const x = findBirdSpawnX(drawSize);
    if (x === null) return; // no safely-spaced gap right now — skip rather than force an unfair spawn

    const t = difficultyT();
    const speedMul = 1 + t * (CONFIG.difficulty.maxSpeedMultiplier - 1); // same global "faster with altitude" ramp every other obstacle uses
    const o = {
      type,
      x,
      y: -drawSize,
      drawSize,
      pressureCost: cfg.cost,
      fallSpeed: (cfg.fallSpeed + randRange(-cfg.fallSpeedVariance, cfg.fallSpeedVariance)) * speedMul,
      seed: Math.random() * 1000
    };
    // Only sparrow/eagle ever dive — pigeons have no diveSpeed at all,
    // their identity is the continuous strafe in updateBirdObstacle().
    if (type !== 'pigeon') {
      o.diveSpeed = (cfg.diveSpeed + randRange(-cfg.diveSpeedVariance, cfg.diveSpeedVariance)) * speedMul;
    }
    initBirdState(o, type);
    state.obstacles.push(o);
  }

  // Called once per bird obstacle at spawn — sets up whichever state
  // machine fields its type actually uses (sparrow/eagle: flap+dive
  // timers; pigeon: strafe phase).
  function initBirdState(o, type) {
    const birds = CONFIG.obstacles.birds;
    o.anim = 'wingsUp';
    o.animElapsedMs = Math.random() * birds.flapFrameTimeMs; // desync flock members
    o.vx = 0;
    if (type === 'pigeon') {
      o.strafePhase = Math.random() * Math.PI * 2; // desync the sine wave between pigeons too
    } else {
      o.diving = false;
      o.diveElapsedMs = 0;
      o.nextDiveCheckInMs = randRange(birds.nosediveCheckIntervalMs * 0.5, birds.nosediveCheckIntervalMs);
      if (type === 'sparrow') {
        o.driftSpeed = randRange(-birds.sparrow.driftSpeedMaxPxPerSec, birds.sparrow.driftSpeedMaxPxPerSec);
        o.triggeredDive = false; // "flew underneath it" dive vs. the ordinary probabilistic one — see updateBirdObstacle()
      }
    }
  }

  // Advances one bird's full behaviour for one frame — fully
  // self-contained (owns its own vertical AND horizontal movement),
  // unlike the other obstacle types whose plain o.y += o.speed*dt still
  // lives in the shared loop in update(). The three types are genuinely
  // different state machines, not variations on one shared shape:
  //   - pigeon: no diving at all — continuous sine-wave strafe blended
  //     with a weak pull toward the player, clamped, for its entire
  //     lifetime. The dive SPRITE is shown purely cosmetically whenever
  //     its own horizontal speed is momentarily small.
  //   - sparrow: flaps normally, occasionally rolls into a nosedive that
  //     — once started — is PERMANENT (never returns to flapping) and
  //     keeps its small constant wobble the whole time.
  //   - eagle: same flap -> PERMANENT-dive shape as the sparrow, but
  //     actively tracks the player horizontally both before AND during
  //     the dive (a sparrow's dive only ever wobbles).
  function updateBirdObstacle(o, dt) {
    const birds = CONFIG.obstacles.birds;
    const cfg = birds[o.type];
    const dtMs = dt * 1000;
    const half = o.drawSize / 2;

    if (o.type === 'pigeon') {
      o.strafePhase += dt;
      o.vx += Math.sin(o.strafePhase * cfg.strafeFrequency) * cfg.strafeSpeed * dt;
      o.vx += (state.rocketX - o.x) * cfg.trackingStrength * dt; // deliberately weak — a loose follow, not a lock-on
      o.vx = Math.max(-cfg.maxHorizontalSpeed, Math.min(cfg.maxHorizontalSpeed, o.vx));
      o.x = Math.max(half, Math.min(DESIGN_W - half, o.x + o.vx * dt));
      o.y += o.fallSpeed * dt;
      // Cosmetic only: looks like it's briefly dropping straight
      // whenever its own horizontal speed is near zero, never actually
      // changing its fall speed or behaviour.
      if (Math.abs(o.vx) < cfg.maxHorizontalSpeed * 0.15) {
        o.anim = 'dive';
      } else {
        if (o.anim === 'dive') { o.anim = 'wingsUp'; o.animElapsedMs = 0; }
        o.animElapsedMs += dtMs;
        if (o.animElapsedMs >= birds.flapFrameTimeMs) {
          o.animElapsedMs -= birds.flapFrameTimeMs;
          o.anim = o.anim === 'wingsUp' ? 'wingsDown' : 'wingsUp';
        }
      }
      return;
    }

    // sparrow + eagle: flap <-> flap until a nosedive starts, then
    // PERMANENTLY diving (never reset back to flapping — see the
    // deliberate absence of any "return to flapping" branch below).
    //
    // Sparrows get a SECOND, entirely separate way into a dive on top of
    // the ordinary probabilistic roll below: "fly underneath it and it
    // immediately dives at you" — checked every single frame (not a
    // timer/probability), and reserved for actually being caught
    // underneath one, so a normal probabilistic dive still only ever
    // wobbles. Checked BEFORE the main !o.diving block below so a
    // trigger this frame is already reflected in this frame's movement/
    // vertical-speed calc, not delayed a frame.
    if (!o.diving && o.type === 'sparrow'
      && Math.abs(state.rocketX - o.x) < cfg.underRocketTriggerHalfWidthPx
      && state.rocketY > o.y) {
      o.diving = true;
      o.diveElapsedMs = birds.nosediveWindupMs; // skip the windup entirely — "immediately dive"
      o.anim = 'dive';
      o.triggeredDive = true;
      o.diveSpeed = cfg.underRocketDiveSpeed + randRange(-cfg.underRocketDiveSpeedVariance, cfg.underRocketDiveSpeedVariance);
    }

    if (!o.diving) {
      o.animElapsedMs += dtMs;
      if (o.animElapsedMs >= birds.flapFrameTimeMs) {
        o.animElapsedMs -= birds.flapFrameTimeMs;
        o.anim = o.anim === 'wingsUp' ? 'wingsDown' : 'wingsUp';
      }
      // Dive roll — checked on its own cooldown timer, never every
      // frame. Base chance (SPARROW_DIVE_CHANCE / EAGLE_DIVE_CHANCE)
      // ramps up to 1.8x by the top of the bird section specifically,
      // so dives get noticeably more frequent as the player climbs.
      o.nextDiveCheckInMs -= dtMs;
      if (o.nextDiveCheckInMs <= 0) {
        o.nextDiveCheckInMs = birds.nosediveCheckIntervalMs;
        const diveChance = cfg.diveChance * (1 + birdSectionProgress(altitudeFraction()) * 0.8);
        if (Math.random() < diveChance) {
          o.diving = true;
          o.diveElapsedMs = 0;
          o.anim = 'dive';
        }
      }
      if (o.type === 'eagle') {
        // Accelerate toward the player's CURRENT x, clamped — an
        // intercept attempt, not an instant homing lock.
        o.vx += (state.rocketX - o.x) * cfg.trackingStrength * dt;
        o.vx = Math.max(-cfg.maxHorizontalSpeed, Math.min(cfg.maxHorizontalSpeed, o.vx));
        o.x = Math.max(half, Math.min(DESIGN_W - half, o.x + o.vx * dt));
      } else {
        o.x = Math.max(half, Math.min(DESIGN_W - half, o.x + o.driftSpeed * dt));
      }
    } else {
      o.diveElapsedMs += dtMs;
      if (o.type === 'eagle') {
        // Unlike a sparrow, an eagle keeps actively strafing WHILE
        // diving — its "capable of horizontal correction" identity.
        // Uses its own strafeSpeed clamp (distinct from the gentler
        // pre-dive maxHorizontalSpeed) since a diving eagle's whole
        // threat is that last-second course correction.
        o.vx += (state.rocketX - o.x) * cfg.trackingStrength * dt;
        o.vx = Math.max(-cfg.strafeSpeed, Math.min(cfg.strafeSpeed, o.vx));
        o.x = Math.max(half, Math.min(DESIGN_W - half, o.x + o.vx * dt));
      } else if (o.type === 'sparrow' && o.triggeredDive) {
        // The "flew underneath it" dive: real, aggressive tracking
        // toward the rocket's CURRENT x — unlike a normal sparrow dive,
        // which only ever wobbles.
        o.vx += (state.rocketX - o.x) * cfg.underRocketTrackingStrength * dt;
        o.vx = Math.max(-cfg.underRocketMaxHorizontalSpeed, Math.min(cfg.underRocketMaxHorizontalSpeed, o.vx));
        o.x = Math.max(half, Math.min(DESIGN_W - half, o.x + o.vx * dt));
      } else {
        // Sparrow: a normal (non-triggered) dive keeps only its small
        // constant wobble.
        o.x = Math.max(half, Math.min(DESIGN_W - half, o.x + o.driftSpeed * dt));
      }
    }

    // Vertical movement: the dive SPRITE switches the instant a dive
    // starts (the visual warning), but the fast diveSpeed only applies
    // after nosediveWindupMs — the bird still falls at its ordinary
    // fallSpeed for that first stretch, giving the player a genuine
    // reaction window before things get "noticeably fast". There is no
    // matching "revert" — once past the windup, a diving sparrow/eagle
    // stays at diveSpeed for the rest of its time on screen.
    const verticalSpeed = (o.diving && o.diveElapsedMs >= birds.nosediveWindupMs) ? o.diveSpeed : o.fallSpeed;
    o.y += verticalSpeed * dt;
  }

  function drawBirdObstacle(ctx2, o) {
    const img = BIRD_IMAGES[o.type] && BIRD_IMAGES[o.type][o.anim];
    if (!img) return; // a still-loading/broken sprite degrades to "just don't draw it", same policy as loadImage()
    ctx2.save();
    ctx2.translate(o.x, o.y);
    ctx2.drawImage(img, -o.drawSize / 2, -o.drawSize / 2, o.drawSize, o.drawSize);
    ctx2.restore();
  }

  // ---- storm cloud obstacles: real animated sprites + lightning ----
  // See CONFIG.obstacles.stormCloud for the shared tuning. Each cloud
  // runs its own independent charge/strike state machine (see
  // updateStormCloud()) — waiting -> charging (flashing, speeding up) ->
  // a strike (or a quiet fizzle) -> waiting again — with a fired bolt
  // living as a short-lived property on the cloud itself (o.lightning)
  // rather than a separate global entity list, since it's always
  // anchored to and moves with its parent cloud.
  function isStormCloudType(type) { return type === 'stormcloud'; }

  // The bolt art's own natural tip direction leans noticeably left of
  // straight-down (measured from the source image: roughly -32° off
  // vertical) — this constant corrects for that so a 0°-bias strike
  // reads as "straight down", with LIGHTNING_ANGLE bias layered on top
  // for the down-left/down-right variants. A pure rotation (no redraw,
  // no distortion of the art itself), same non-destructive technique as
  // every other sprite transform in this file.
  const LIGHTNING_ART_CORRECTION_DEG = 32;

  // A spawn ATTEMPT (see update()'s spawn-timer block) — skipped
  // outright once maxActiveClouds is already reached, same "skip rather
  // than force it" policy the bird spawner's pressure budget uses. A
  // cloud can take several seconds to fall off-screen, so the spawn
  // timer alone would otherwise let them quietly stack up well past a
  // dodgeable amount.
  function trySpawnStormCloud() {
    const cfg = CONFIG.obstacles.stormCloud;
    const activeClouds = state.obstacles.reduce((n, o) => n + (isStormCloudType(o.type) ? 1 : 0), 0);
    if (activeClouds >= cfg.maxActiveClouds) return;
    const scale = randRange(cfg.minScale, cfg.maxScale);
    const drawSize = cfg.baseSize * scale;
    const t = difficultyT();
    const speedMul = 1 + t * (CONFIG.difficulty.maxSpeedMultiplier - 1); // same global "faster with altitude" ramp every other obstacle uses
    // Fall speed is DERIVED from this cloud's own rolled scale — bigger
    // clouds are always slower, smaller ones always faster, interpolated
    // between the two configured endpoints rather than a flat speed
    // independent of size.
    const sizeT = (scale - cfg.minScale) / (cfg.maxScale - cfg.minScale);
    const baseFallSpeed = cfg.fallSpeedForMinScale + (cfg.fallSpeedForMaxScale - cfg.fallSpeedForMinScale) * sizeT;
    const o = {
      type: 'stormcloud',
      x: randRange(drawSize / 2, DESIGN_W - drawSize / 2),
      y: -drawSize,
      drawSize,
      scale,
      fallSpeed: (baseFallSpeed + randRange(-cfg.fallSpeedVariance, cfg.fallSpeedVariance)) * speedMul,
      seed: Math.random() * 1000,
      anim: 'normal',
      phase: 'waiting',
      phaseElapsedMs: 0,
      // Randomised so a screen full of clouds doesn't all charge/strike
      // in lockstep — reused both for the pre-first-charge wait and
      // every subsequent post-strike cooldown (see updateStormCloud()).
      waitDurationMs: randRange(cfg.strikeCooldownMs * 0.4, cfg.strikeCooldownMs * 0.9),
      flashTimer: 0,
      lightning: null
    };
    state.obstacles.push(o);
  }

  // Picks where along the cloud's lower perimeter a bolt originates, and
  // which of the three angle buckets ("mostly downward" / down-left /
  // down-right) it fires in — see LIGHTNING_ART_CORRECTION_DEG above for
  // why a bucket's own bias range is added on top of that correction.
  function fireLightning(o) {
    const cfg = CONFIG.obstacles.stormCloud;
    const bucket = Math.random();
    const biasDeg = bucket < 0.5 ? randRange(-10, 10) // mostly downward — the common case
      : bucket < 0.75 ? randRange(-40, -16) // down-left
        : randRange(16, 40); // down-right
    const range = o.drawSize * cfg.lightningRange;
    o.lightning = {
      originDx: randRange(-o.drawSize * 0.28, o.drawSize * 0.28), // along the cloud's lower body, not always dead-centre
      originDy: o.drawSize * 0.22,
      angleDeg: LIGHTNING_ART_CORRECTION_DEG + biasDeg,
      length: range * randRange(0.85, 1.15),
      width: range * 0.32,
      spriteIndex: Math.floor(Math.random() * cfg.lightningImages.length),
      remainingMs: cfg.lightningActiveMs,
      hitApplied: false
    };
  }

  // Both the collision test and the drawing code call this so the
  // hitbox and the visible bolt can never drift apart — returns the
  // bolt's origin and tip in WORLD (canvas) coordinates plus the angle
  // used to draw it.
  function lightningWorldGeometry(o) {
    const L = o.lightning;
    const angleRad = L.angleDeg * Math.PI / 180;
    const dirX = Math.sin(angleRad), dirY = Math.cos(angleRad); // 0deg = straight down (0,1)
    const originX = o.x + L.originDx, originY = o.y + L.originDy;
    return {
      angleRad,
      originX, originY,
      tipX: originX + dirX * L.length,
      tipY: originY + dirY * L.length
    };
  }

  function updateStormCloud(o, dt) {
    const cfg = CONFIG.obstacles.stormCloud;
    const dtMs = dt * 1000;
    o.phaseElapsedMs += dtMs;

    if (o.phase === 'waiting') {
      o.anim = 'normal';
      if (o.phaseElapsedMs >= o.waitDurationMs) {
        o.phase = 'charging';
        o.phaseElapsedMs = 0;
        o.flashTimer = 0;
      }
    } else if (o.phase === 'charging') {
      const chargeT = Math.min(1, o.phaseElapsedMs / cfg.chargeTimeMs);
      // Flash interval shrinks (flashes get quicker) as the charge
      // nears completion — the ramping urgency IS the warning.
      const flashInterval = cfg.flashRateMaxMs + (cfg.flashRateMinMs - cfg.flashRateMaxMs) * chargeT;
      o.flashTimer -= dtMs;
      if (o.flashTimer <= 0) {
        o.flashTimer = flashInterval;
        o.anim = o.anim === 'charged' ? 'normal' : 'charged';
      }
      if (o.phaseElapsedMs >= cfg.chargeTimeMs) {
        if (Math.random() < cfg.strikeChance) fireLightning(o);
        o.phase = 'waiting';
        o.phaseElapsedMs = 0;
        o.anim = 'normal';
        o.waitDurationMs = randRange(cfg.strikeCooldownMs * 0.8, cfg.strikeCooldownMs * 1.3);
      }
    }

    if (o.lightning) {
      o.lightning.remainingMs -= dtMs;
      if (o.lightning.remainingMs <= 0) o.lightning = null;
    }
  }

  // Distance from the rocket to the bolt's actual drawn line segment
  // (not its full square sprite bounds) — see CONFIG.obstacles.
  // stormCloud.lightningHitRadius for the fairness margin around that line.
  function lightningHitTest(o) {
    if (!o.lightning) return false;
    const g = lightningWorldGeometry(o);
    const dx = g.tipX - g.originX, dy = g.tipY - g.originY;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((state.rocketX - g.originX) * dx + (state.rocketY - g.originY) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const nearX = g.originX + dx * t, nearY = g.originY + dy * t;
    const ddx = state.rocketX - nearX, ddy = state.rocketY - nearY;
    const hitRadius = CONFIG.collision.rocketRadius + CONFIG.obstacles.stormCloud.lightningHitRadius;
    return (ddx * ddx + ddy * ddy) <= hitRadius * hitRadius;
  }

  function drawStormCloud(ctx2, o) {
    const img = STORM_IMAGES[o.anim];
    if (img) {
      ctx2.save();
      ctx2.translate(o.x, o.y);
      ctx2.drawImage(img, -o.drawSize / 2, -o.drawSize / 2, o.drawSize, o.drawSize);
      ctx2.restore();
    }
    if (o.lightning) {
      const boltImg = STORM_IMAGES.lightning[o.lightning.spriteIndex];
      if (boltImg) {
        const g = lightningWorldGeometry(o);
        // Fade the bolt out over its last third of life instead of a
        // hard cut, so it doesn't just blink out of existence.
        const lifeFrac = o.lightning.remainingMs / CONFIG.obstacles.stormCloud.lightningActiveMs;
        ctx2.save();
        ctx2.globalAlpha = Math.min(1, lifeFrac * 2.2);
        ctx2.translate(g.originX, g.originY);
        ctx2.rotate(g.angleRad);
        // The source art's own bolt runs corner-to-corner of its square
        // canvas; drawn at (width x length) starting from the origin
        // (its wide/top end) down to the tip, matching lightningWorldGeometry()'s
        // length exactly so the visible art and the hitbox line agree.
        ctx2.drawImage(boltImg, -o.lightning.width / 2, 0, o.lightning.width, o.lightning.length);
        ctx2.restore();
      }
    }
  }

  // ---- Satellite Belt: real sprites + a progress-scaled difficulty curve ----
  // See CONFIG.obstacles.satelliteBelt for the shared tuning. Unlike
  // birds/stormClouds, satellites don't run a per-instance behavioural
  // state machine — the interesting part here is entirely in HOW they
  // get spawned: single, generously-spaced picks early on, building up
  // to designed multi-satellite PATTERNS (see triggerSatellitePattern())
  // that always leave a guaranteed safe lane, never a random screen-fill.
  function isSatelliteType(type) {
    return !!CONFIG.obstacles.satelliteBelt.types[type];
  }

  function satelliteDrawSize(type) {
    return CONFIG.obstacles.satelliteBelt.types[type].baseSize;
  }

  // SATELLITE_BELT_PROGRESS — 0 right as altitude enters the `satellites`
  // zone, 1 right as it reaches the `space` zone above. Computed from
  // the zone boundaries directly rather than a second hard-coded range,
  // so it can never drift out of sync if those zone `start` fractions
  // are ever retuned.
  function satelliteBeltProgress() {
    const zones = CONFIG.obstacles.zones;
    const start = zones.find((z) => z.name === 'satellites').start;
    const end = zones.find((z) => z.name === 'meteors').start;
    return Math.max(0, Math.min(1, (altitudeFraction() - start) / (end - start)));
  }

  // Same "last band whose threshold <= value wins" convention as
  // currentBirdBand()/currentObstacleZone().
  function currentSatelliteBand(progress) {
    const bands = CONFIG.obstacles.satelliteBelt.progressBands;
    let band = bands[0];
    for (let i = 0; i < bands.length; i++) { if (progress >= bands[i].progress) band = bands[i]; }
    return band;
  }

  // Same "skip the spawn outright rather than force an overlap" gap
  // check the bird spawner uses — this, not just SATELLITE_MAX_ACTIVE,
  // is what actually guarantees a dodgeable route for a plain spawn.
  function findSatelliteSpawnX(drawSize) {
    const cfg = CONFIG.obstacles.satelliteBelt;
    const half = drawSize / 2;
    const minX = half, maxX = DESIGN_W - half;
    const nearTopX = state.obstacles
      .filter((o) => o.y < cfg.spawnGapZoneHeightPx)
      .map((o) => o.x);
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = randRange(minX, maxX);
      if (nearTopX.every((ox) => Math.abs(ox - x) >= cfg.minSpawnGapPx)) return x;
    }
    return null;
  }

  // Places exactly one satellite — used both for a plain single spawn
  // AND for each entry a pattern queues up (see the satelliteSpawnQueue
  // processing in update()). speedMultiplier comes from the CURRENT
  // band at the moment this specific satellite actually spawns (queued
  // pattern entries carry their own band reference so a slow-building
  // pattern can't retroactively get faster mid-flight).
  function spawnSatelliteAt(type, x, speedMultiplier) {
    const typeCfg = CONFIG.obstacles.satelliteBelt.types[type];
    const drawSize = satelliteDrawSize(type);
    const o = {
      type,
      x,
      y: -drawSize,
      drawSize,
      fallSpeed: (typeCfg.fallSpeed + randRange(-typeCfg.fallSpeedVariance, typeCfg.fallSpeedVariance)) * speedMultiplier,
      seed: Math.random() * 1000,
      rotationDeg: 0
    };
    if (type === 'spinner') o.spinSpeedDegPerSec = typeCfg.spinSpeedDegPerSec * (Math.random() < 0.5 ? -1 : 1);
    if (type === 'diagonal') o.driftSpeed = typeCfg.diagonalDriftPxPerSec * (Math.random() < 0.5 ? -1 : 1);
    state.obstacles.push(o);
  }

  function updateSatellite(o, dt) {
    if (o.type === 'spinner') o.rotationDeg += o.spinSpeedDegPerSec * dt;
    if (o.type === 'diagonal') o.x += o.driftSpeed * dt; // deliberately NOT clamped to the screen edge — a diagonal mover is meant to drift off the side, not slide along the wall
    o.y += o.fallSpeed * dt;
  }

  function drawSatellite(ctx2, o) {
    const img = SATELLITE_IMAGES[o.type];
    if (!img) return; // a still-loading/broken sprite degrades to "just don't draw it"
    ctx2.save();
    ctx2.translate(o.x, o.y);
    if (o.type === 'spinner') ctx2.rotate(o.rotationDeg * Math.PI / 180); // purely visual — the hitbox stays a plain circle, see checkCollisions()
    ctx2.drawImage(img, -o.drawSize / 2, -o.drawSize / 2, o.drawSize, o.drawSize);
    ctx2.restore();
  }

  // Builds the relative (delayMs, x, type) entries for one named
  // pattern, in DESIGN-space coordinates. Every pattern is hand-laid-out
  // to guarantee at least one clear lane — see each pattern's own
  // comment for exactly where that lane is.
  function buildSatellitePattern(name) {
    const W = DESIGN_W;
    if (name === 'slalom') {
      // Alternating left/right lanes, staggered in TIME rather than
      // space — only ever one on screen from this pattern at once, the
      // player weaves back and forth to follow it.
      const types = ['wide', 'diagonal'];
      return [0, 1, 2, 3].map((i) => ({ delayMs: i * 450, x: i % 2 === 0 ? W * 0.25 : W * 0.75, type: types[i % 2] }));
    }
    if (name === 'gate') {
      // Two Wide satellites simultaneously, leaving a fixed-width gap
      // in the middle comfortably wider than the rocket itself.
      const gap = 340;
      const cx = W / 2;
      const half = satelliteDrawSize('wide') / 2;
      return [
        { delayMs: 0, x: cx - gap / 2 - half, type: 'wide' },
        { delayMs: 0, x: cx + gap / 2 + half, type: 'wide' }
      ];
    }
    if (name === 'fastRain') {
      // The width is split into 4 lanes; one random lane is left
      // completely untouched as the guaranteed safe path while Thin
      // Fast satellites drop through the other three, staggered.
      const lanes = 4, laneW = W / lanes;
      const safeLane = Math.floor(Math.random() * lanes);
      const entries = [];
      let delay = 0;
      for (let i = 0; i < lanes; i++) {
        if (i === safeLane) continue;
        entries.push({ delayMs: delay, x: laneW * i + laneW / 2, type: 'thinFast' });
        delay += 160;
      }
      return entries;
    }
    if (name === 'mixed') {
      // Wide blocks the left lane, Diagonal crosses the middle, Thin
      // Fast follows through the right lane shortly after — the left
      // lane (once Wide has largely passed) and the untouched far right
      // approach both stay realistically reachable.
      return [
        { delayMs: 0, x: W * 0.2, type: 'wide' },
        { delayMs: 300, x: W * 0.5, type: 'diagonal' },
        { delayMs: 600, x: W * 0.8, type: 'thinFast' }
      ];
    }
    // 'spinnerPressure': a Spinner anchors the centre lane, then ONE
    // side (chosen at random) gets a second satellite shortly after —
    // the OTHER side is deliberately left completely open as the
    // guaranteed escape route.
    const sideLeft = Math.random() < 0.5;
    return [
      { delayMs: 0, x: W * 0.5, type: 'spinner' },
      { delayMs: 400, x: sideLeft ? W * 0.15 : W * 0.85, type: Math.random() < 0.5 ? 'wide' : 'diagonal' }
    ];
  }

  // Queues up one named pattern's entries (see buildSatellitePattern())
  // onto state.satelliteSpawnQueue, each carrying the CURRENT band's
  // speedMultiplier so every satellite in the pattern spawns at the
  // right speed once its own delay elapses (processed in update()).
  function triggerSatellitePattern(band) {
    const cfg = CONFIG.obstacles.satelliteBelt;
    const patterns = band.patternDifficulty >= 2
      ? ['slalom', 'gate', 'fastRain', 'mixed', 'spinnerPressure']
      : ['gate', 'spinnerPressure'];
    const name = patterns[Math.floor(Math.random() * patterns.length)];
    buildSatellitePattern(name).forEach((e) => {
      state.satelliteSpawnQueue.push({ delayMs: e.delayMs, x: e.x, type: e.type, speedMultiplier: band.speedMultiplier });
    });
    // A band's own patternCooldownMs (see the final "wave" band) makes
    // patterns chain back-to-back for a near-continuous stream instead
    // of the usual well-spaced set-pieces.
    state.nextSatellitePatternAllowedAt = performance.now() + (band.patternCooldownMs != null ? band.patternCooldownMs : cfg.patternCooldownMs);
  }

  // The satellite belt's spawn ATTEMPT (see update()'s spawn-timer
  // block) — like the bird/stormCloud spawners, an attempt can end up
  // spawning nothing at all: SATELLITE_MAX_ACTIVE already reached, or no
  // safely-spaced gap for a plain spawn right now.
  function trySpawnSatellite() {
    const band = currentSatelliteBand(satelliteBeltProgress());
    const activeCount = state.obstacles.reduce((n, o) => n + (isSatelliteType(o.type) ? 1 : 0), 0);
    if (activeCount >= band.maxActive) return;

    // Patterns are deliberate multi-satellite set-pieces. Earlier bands
    // only ever consider one while the screen is still fairly clear, so
    // a burst never lands on top of an already-busy moment; the higher
    // a band's own maxActive, the busier the screen is allowed to be
    // when a NEW pattern still gets considered — by the final "wave"
    // band this is loose enough that patterns genuinely overlap into a
    // continuous stream, which is the point.
    const patternChance = band.patternChance || 0;
    // Loosened from `band.maxActive - 2` to `- 1`: on the early/build
    // bands (maxActive 1-2) this is unchanged, but on the final "wave"
    // band (maxActive 12) it lets a new pattern queue almost regardless
    // of how busy the screen already is — "satellites must appear
    // continuously during the entire barrage... do not let the barrage
    // end early or contain long empty pauses".
    const patternBusyThreshold = Math.max(1, band.maxActive - 1);
    if (patternChance > 0 && activeCount <= patternBusyThreshold && performance.now() >= state.nextSatellitePatternAllowedAt
      && Math.random() < patternChance) {
      triggerSatellitePattern(band);
      return;
    }

    const type = band.types[Math.floor(Math.random() * band.types.length)];
    const drawSize = satelliteDrawSize(type);
    const x = findSatelliteSpawnX(drawSize);
    if (x === null) return; // no safely-spaced gap right now — skip rather than force an unfair spawn
    spawnSatelliteAt(type, x, band.speedMultiplier);
  }

  // ---- Meteor Wave: real sprites, 3 distinct meteor identities ----
  // See CONFIG.obstacles.meteorWave for the shared tuning. Runs from the
  // `meteors` zone's own start all the way to the Moon — no zone after
  // it, so (unlike satellites easing into the storm section) this just
  // uses the normal single-zone spawn-timer dispatch.
  function isMeteorWaveType(type) {
    return type === 'meteorNormal' || type === 'meteorFire' || type === 'meteorCracked' || type === 'meteorFragment';
  }

  function meteorDrawSize(type) {
    const cfg = CONFIG.obstacles.meteorWave;
    return type === 'meteorFragment' ? cfg.fragment.baseSize : cfg.baseSize;
  }

  // 0 right as altitude enters the `meteors` zone, 1 right at the Moon.
  function meteorWaveProgress() {
    const start = CONFIG.obstacles.zones.find((z) => z.name === 'meteors').start;
    return Math.max(0, Math.min(1, (altitudeFraction() - start) / (1 - start)));
  }

  function currentMeteorBand(progress) {
    const bands = CONFIG.obstacles.meteorWave.progressBands;
    let band = bands[0];
    for (let i = 0; i < bands.length; i++) { if (progress >= bands[i].progress) band = bands[i]; }
    return band;
  }

  function activeMeteorCost() {
    let sum = 0;
    for (const o of state.obstacles) if (isMeteorWaveType(o.type)) sum += o.cost || 0;
    return sum;
  }

  function pickWeightedMeteorType(band) {
    const entries = Object.entries(band.weights).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [type, w] of entries) {
      if (r < w) return type;
      r -= w;
    }
    return entries[entries.length - 1][0];
  }

  // Same "skip the spawn outright rather than force an overlap" gap
  // check the bird/satellite spawners use.
  function findMeteorSpawnX(drawSize) {
    const cfg = CONFIG.obstacles.meteorWave;
    const half = drawSize / 2;
    const minX = half, maxX = DESIGN_W - half;
    const nearTopX = state.obstacles
      .filter((o) => isMeteorWaveType(o.type) && o.y < cfg.spawnGapZoneHeightPx)
      .map((o) => o.x);
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = randRange(minX, maxX);
      if (nearTopX.every((ox) => Math.abs(ox - x) >= cfg.minSpawnGapPx)) return x;
    }
    return null;
  }

  function spawnMeteorNormal(x, speedMul) {
    const cfg = CONFIG.obstacles.meteorWave.normal;
    const drawSize = meteorDrawSize('meteorNormal');
    const direction = ['vertical', 'diagonalLeft', 'diagonalRight'][Math.floor(Math.random() * 3)];
    const vx = direction === 'diagonalLeft' ? -cfg.diagonalSpeedPxPerSec
      : direction === 'diagonalRight' ? cfg.diagonalSpeedPxPerSec : 0;
    state.obstacles.push({
      type: 'meteorNormal',
      x, y: -drawSize, drawSize,
      fallSpeed: (cfg.fallSpeed + randRange(-cfg.fallSpeedVariance, cfg.fallSpeedVariance)) * speedMul,
      vx,
      rotationDeg: Math.random() * 360,
      rotationSpeed: (cfg.rotationSpeedDegPerSec + randRange(-cfg.rotationSpeedVariance, cfg.rotationSpeedVariance)) * (Math.random() < 0.5 ? -1 : 1),
      cost: cfg.cost,
      seed: Math.random() * 1000
    });
  }

  function spawnMeteorFire(x, speedMul) {
    const cfg = CONFIG.obstacles.meteorWave.fire;
    const drawSize = meteorDrawSize('meteorFire');
    // Spawns mostly off-screen above, with just its glowing tip peeking
    // below y=0 — the "brief visual warning" — and STAYS there (no
    // movement) until warningTimeMs elapses, at which point it starts
    // falling at full fallSpeed from that same position: a sudden speed
    // burst rather than a position jump.
    state.obstacles.push({
      type: 'meteorFire',
      x, y: -drawSize + drawSize * 0.16, drawSize,
      fallSpeed: cfg.fallSpeed * speedMul,
      phase: 'warning',
      warningElapsedMs: 0,
      warningTotalMs: cfg.warningTimeMs,
      cost: cfg.cost,
      seed: Math.random() * 1000
    });
  }

  function spawnMeteorCracked(x, speedMul) {
    const cfg = CONFIG.obstacles.meteorWave.cracked;
    const drawSize = meteorDrawSize('meteorCracked');
    state.obstacles.push({
      type: 'meteorCracked',
      x, y: -drawSize, drawSize,
      fallSpeed: (cfg.fallSpeed + randRange(-cfg.fallSpeedVariance, cfg.fallSpeedVariance)) * speedMul,
      stage: 'falling',
      elapsedMs: 0,
      crackDelayMs: randRange(cfg.crackDelayMinMs, cfg.crackDelayMaxMs),
      crackFrameElapsedMs: 0,
      cost: cfg.cost,
      seed: Math.random() * 1000
    });
  }

  // Called the instant a cracked meteor finishes its pop — 5 independent
  // fragments burst outward+upward from its current position, each with
  // its OWN horizontal velocity, upward kick, rotation speed, and sprite
  // (cycling through the 4 supplied fragment images — see the asset note
  // on CONFIG.obstacles.meteorWave). Gravity then takes over per-frame
  // in updateMeteorObstacle().
  function spawnMeteorFragments(x, y) {
    const cfg = CONFIG.obstacles.meteorWave.fragment;
    const images = CONFIG.obstacles.meteorWave.images.fragments;
    const drawSize = cfg.baseSize;
    // left+up, slight-left+up, mostly-up, slight-right+up, right+up —
    // matches the example concept, widened further ("wide spread...
    // genuinely difficult to dodge" — was [-1,-0.5,0,0.5,1]) so the
    // outer two fragments burst much further to each side; randomised
    // magnitude per fragment so no two ever move identically.
    const horizontalFactors = [-1.6, -0.8, 0, 0.8, 1.6];
    horizontalFactors.forEach((factor, i) => {
      state.obstacles.push({
        type: 'meteorFragment',
        x, y, drawSize,
        vx: factor * cfg.popSpeed * randRange(0.8, 1.2),
        vy: -cfg.upwardForce * randRange(0.7, 1.3),
        rotationDeg: Math.random() * 360,
        rotationSpeed: cfg.rotationSpeedDegPerSec * randRange(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1),
        spriteIndex: i % images.length, // only 4 unique sprites for 5 physics fragments — see the asset note above
        cost: 1,
        seed: Math.random() * 1000
      });
    });
  }

  // Advances one meteor-wave obstacle's full behaviour for one frame —
  // fully self-contained, like the bird/satellite updaters. A cracked
  // meteor reaching stage 'popped' is handled by the caller (the main
  // obstacle-advance loop in update()), which spawns its fragments and
  // removes it the same frame.
  function updateMeteorObstacle(o, dt) {
    if (o.type === 'meteorNormal') {
      o.rotationDeg += o.rotationSpeed * dt;
      o.x += o.vx * dt;
      o.y += o.fallSpeed * dt;
    } else if (o.type === 'meteorFire') {
      if (o.phase === 'warning') {
        o.warningElapsedMs += dt * 1000;
        if (o.warningElapsedMs >= o.warningTotalMs) o.phase = 'falling';
      } else {
        o.y += o.fallSpeed * dt;
      }
    } else if (o.type === 'meteorCracked') {
      const cfg = CONFIG.obstacles.meteorWave.cracked;
      const dtMs = dt * 1000;
      o.y += o.fallSpeed * dt; // keeps falling through every stage, including the crack animation itself
      if (o.stage === 'falling') {
        o.elapsedMs += dtMs;
        if (o.elapsedMs >= o.crackDelayMs) { o.stage = 'cracked1'; o.crackFrameElapsedMs = 0; }
      } else if (o.stage === 'cracked1') {
        o.crackFrameElapsedMs += dtMs;
        if (o.crackFrameElapsedMs >= cfg.crackFrameTimeMs) { o.stage = 'cracked2'; o.crackFrameElapsedMs = 0; }
      } else if (o.stage === 'cracked2') {
        o.crackFrameElapsedMs += dtMs;
        if (o.crackFrameElapsedMs >= cfg.crackFrameTimeMs) o.stage = 'popped';
      }
    } else if (o.type === 'meteorFragment') {
      const cfg = CONFIG.obstacles.meteorWave.fragment;
      o.vy = Math.min(o.vy + cfg.gravity * dt, cfg.fallSpeed);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rotationDeg += o.rotationSpeed * dt;
    }
  }

  function drawMeteorObstacle(ctx2, o) {
    const images = METEOR_IMAGES;
    if (o.type === 'meteorNormal' || o.type === 'meteorFire') {
      const img = o.type === 'meteorNormal' ? images.normal : images.fire;
      if (!img) return;
      ctx2.save();
      ctx2.translate(o.x, o.y);
      if (o.type === 'meteorNormal') ctx2.rotate(o.rotationDeg * Math.PI / 180);
      ctx2.drawImage(img, -o.drawSize / 2, -o.drawSize / 2, o.drawSize, o.drawSize);
      ctx2.restore();
      return;
    }
    if (o.type === 'meteorCracked') {
      const cfg = CONFIG.obstacles.meteorWave.cracked;
      let img = images.normal, scale = 1, shakeX = 0, shakeY = 0, flashAlpha = 0;
      if (o.stage === 'cracked1') {
        img = images.crackedStage1;
        scale = 1 + 0.05 * Math.sin((o.crackFrameElapsedMs / cfg.crackFrameTimeMs) * Math.PI);
      } else if (o.stage === 'cracked2' || o.stage === 'popped') {
        img = images.crackedStage2;
        const t = o.crackFrameElapsedMs / cfg.crackFrameTimeMs;
        scale = 1 + 0.12 * Math.sin(t * Math.PI); // subtle scale pulse
        shakeX = (Math.random() - 0.5) * 6; // tiny shake
        shakeY = (Math.random() - 0.5) * 6;
        flashAlpha = 0.35 * Math.sin(t * Math.PI); // small flash
      }
      if (!img) return;
      ctx2.save();
      ctx2.translate(o.x + shakeX, o.y + shakeY);
      ctx2.scale(scale, scale);
      ctx2.drawImage(img, -o.drawSize / 2, -o.drawSize / 2, o.drawSize, o.drawSize);
      if (flashAlpha > 0) {
        ctx2.globalAlpha = flashAlpha;
        ctx2.fillStyle = '#fff8d0';
        ctx2.beginPath();
        ctx2.arc(0, 0, o.drawSize * 0.5, 0, Math.PI * 2);
        ctx2.fill();
      }
      ctx2.restore();
      return;
    }
    if (o.type === 'meteorFragment') {
      const img = images.fragments[o.spriteIndex];
      if (!img) return;
      ctx2.save();
      ctx2.translate(o.x, o.y);
      ctx2.rotate(o.rotationDeg * Math.PI / 180);
      ctx2.drawImage(img, -o.drawSize / 2, -o.drawSize / 2, o.drawSize, o.drawSize);
      ctx2.restore();
    }
  }

  // The Meteor Wave's spawn ATTEMPT (see update()'s spawn-timer block)
  // — like the other sprite-driven spawners, an attempt can end up
  // spawning nothing at all: maxActiveCost already reached, a cracked
  // meteor picked while one is already mid-sequence ("do not spawn
  // several cracking meteors on top of each other"), or no safely-spaced
  // gap right now.
  function trySpawnMeteor() {
    const cfg = CONFIG.obstacles.meteorWave;
    const band = currentMeteorBand(meteorWaveProgress());
    const type = pickWeightedMeteorType(band); // 'normal' | 'fire' | 'cracked'
    if (type === 'cracked') {
      const activeCracked = state.obstacles.reduce((n, o) => n + (o.type === 'meteorCracked' ? 1 : 0), 0);
      if (activeCracked >= cfg.cracked.maxSimultaneous) return;
    }
    const typeCost = type === 'normal' ? cfg.normal.cost : type === 'fire' ? cfg.fire.cost : cfg.cracked.cost;
    if (activeMeteorCost() + typeCost > cfg.maxActiveCost) return;
    const x = findMeteorSpawnX(cfg.baseSize);
    if (x === null) return; // no safely-spaced gap right now — skip rather than force an unfair spawn
    if (type === 'normal') spawnMeteorNormal(x, band.speedMultiplier);
    else if (type === 'fire') spawnMeteorFire(x, band.speedMultiplier);
    else spawnMeteorCracked(x, band.speedMultiplier);
  }

  function currentObstacleZone() {
    const frac = altitudeFraction();
    const zones = CONFIG.obstacles.zones;
    let zone = zones[0];
    for (let i = 0; i < zones.length; i++) { if (frac >= zones[i].start) zone = zones[i]; }
    return zone;
  }

  // Non-bird obstacle types only (storm/satellites/space) — birds spawn
  // exclusively through trySpawnBirdObstacle() instead, see update()'s
  // spawn-timer block.
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
      seed: Math.random() * 1000,
      drawSize: cfg.width
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
    if (!FUEL_IMAGE) return; // still loading/broken — same "just don't draw it" policy as every other sprite
    const cfg = CONFIG.fuel;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.drawImage(FUEL_IMAGE, -cfg.pickupWidth / 2, -cfg.pickupHeight / 2, cfg.pickupWidth, cfg.pickupHeight);
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
    const genericRadius = CONFIG.obstacles.width * col.obstacleRadiusFactor;
    for (let i = 0; i < state.obstacles.length; i++) {
      const o = state.obstacles[i];
      // A storm cloud's lightning bolt is a completely separate,
      // fair, line-shaped hitbox — checked BEFORE the cloud's own
      // (tighter) body radius, using the dedicated LIGHTNING_DAMAGE
      // amount rather than the generic per-obstacle penalty.
      if (isStormCloudType(o.type) && lightningHitTest(o)) {
        onObstacleHit(CONFIG.obstacles.stormCloud.lightningDamage);
        break;
      }
      // Birds and storm clouds each get their own tighter, body-only
      // hitbox (see CONFIG.obstacles.birds.hitboxFactor / stormCloud.
      // hitboxFactor) — their sprite's transparent margins take up far
      // more of the drawn box than the other obstacle art does, so
      // reusing the generic radius would make near-misses register as
      // unfair hits.
      const or_ = isBirdType(o.type) ? o.drawSize * CONFIG.obstacles.birds.hitboxFactor
        : isStormCloudType(o.type) ? o.drawSize * CONFIG.obstacles.stormCloud.hitboxFactor
          : isSatelliteType(o.type) ? o.drawSize * CONFIG.obstacles.satelliteBelt.hitboxFactor
            : o.type === 'meteorFragment' ? o.drawSize * CONFIG.obstacles.meteorWave.fragment.hitboxFactor
              : isMeteorWaveType(o.type) ? o.drawSize * CONFIG.obstacles.meteorWave.hitboxFactor
                : genericRadius;
      if (circleHit(state.rocketX, state.rocketY, rocketR, o.x, o.y, or_)) {
        onObstacleHit();
        break;
      }
    }
  }

  // penalty defaults to the generic OBSTACLE_DAMAGE — pass an override
  // (e.g. stormCloud.lightningDamage) for a hazard with its own named
  // damage amount.
  function onObstacleHit(penalty) {
    state.hitFlashUntil = performance.now() + 220;
    if (CONFIG.obstacles.collisionEndsRun) {
      // Not the default — kept as an easy on/off switch for a future
      // harder difficulty mode.
      finishRun('crash');
      return;
    }
    // Default path: a hit costs fuel rather than ending the run
    // outright. If this drains the tank to 0, update()'s `if
    // (state.fuel <= 0) finishRun('fuel')` check (which runs right
    // after checkCollisions() every frame) catches it the same frame —
    // the run still ends, just correctly attributed to running out of
    // fuel rather than a generic "crash".
    state.invulnerableUntil = performance.now() + CONFIG.obstacles.collisionInvulnerabilityMs;
    state.fuel = Math.max(0, state.fuel - (penalty != null ? penalty : CONFIG.obstacles.collisionFuelPenalty));
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

      // obstacle spawning, per current altitude zone — storm/space/birds
      // share this single-active-zone dispatch; satellites deliberately
      // do NOT (see the independent timer just below) since they need
      // to ease in ALONGSIDE the tail of the storm cloud section rather
      // than starting on a hard zone cutoff.
      const zone = currentObstacleZone();
      state.zoneSpawnTimers[zone.name] -= dt * 1000;
      if (zone.name !== 'satellites' && state.zoneSpawnTimers[zone.name] <= 0) {
        if (zone.name === 'birds') trySpawnBirdObstacle();
        else if (zone.name === 'storm') trySpawnStormCloud();
        else if (zone.name === 'meteors') trySpawnMeteor();
        else spawnObstacle(zone);
        const t = difficultyT();
        const mul = 1 - t * (1 - CONFIG.difficulty.minSpawnIntervalMultiplier);
        // STORM_CLOUD_SPAWN_RATE (stormCloud.spawnRateMultiplier) and the
        // Meteor Wave's own current-band spawnIntervalMultiplier are
        // extra knobs on top of the global obstacles.spawnRateMultiplier
        // every zone already gets, specific to each hazard.
        const stormMul = zone.name === 'storm' ? CONFIG.obstacles.stormCloud.spawnRateMultiplier : 1;
        const meteorMul = zone.name === 'meteors' ? currentMeteorBand(meteorWaveProgress()).spawnIntervalMultiplier : 1;
        state.zoneSpawnTimers[zone.name] = randRange(zone.spawnIntervalMinMs, zone.spawnIntervalMaxMs) * mul * CONFIG.obstacles.spawnRateMultiplier * stormMul * meteorMul;
      }

      // Satellite Belt spawning runs on its OWN independent timer,
      // active over an ALTITUDE RANGE rather than gated by which zone
      // is nominally "current" — from satelliteBelt.earlyStartFraction
      // (still inside the storm cloud section) through to the `meteors`
      // zone. satelliteBeltProgress() naturally clamps to 0 before the
      // belt's own official start, so this early window plays band 0
      // (rarest, single-at-a-time) — satellites genuinely ease in next
      // to the clouds rather than the belt starting with a hard cut.
      {
        const satCfg = CONFIG.obstacles.satelliteBelt;
        const meteorsStart = CONFIG.obstacles.zones.find((z) => z.name === 'meteors').start;
        const satFrac = altitudeFraction();
        if (satFrac >= satCfg.earlyStartFraction && satFrac < meteorsStart) {
          state.satelliteSpawnTimerMs -= dt * 1000;
          if (state.satelliteSpawnTimerMs <= 0) {
            trySpawnSatellite();
            const band = currentSatelliteBand(satelliteBeltProgress());
            const satZone = CONFIG.obstacles.zones.find((z) => z.name === 'satellites');
            const t = difficultyT();
            const mul = 1 - t * (1 - CONFIG.difficulty.minSpawnIntervalMultiplier);
            state.satelliteSpawnTimerMs = randRange(satZone.spawnIntervalMinMs, satZone.spawnIntervalMaxMs) * mul * CONFIG.obstacles.spawnRateMultiplier * band.spawnIntervalMultiplier;
          }
        }
      }

      // satellite belt pattern queue — each entry spawns once its own
      // delay elapses (see triggerSatellitePattern()); processed every
      // frame independently of the zone spawn-timer above.
      for (let i = state.satelliteSpawnQueue.length - 1; i >= 0; i--) {
        const q = state.satelliteSpawnQueue[i];
        q.delayMs -= dt * 1000;
        if (q.delayMs <= 0) {
          spawnSatelliteAt(q.type, q.x, q.speedMultiplier);
          state.satelliteSpawnQueue.splice(i, 1);
        }
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
        if (isBirdType(o.type)) {
          updateBirdObstacle(o, dt); // self-contained: owns its own vertical + horizontal movement
        } else if (isStormCloudType(o.type)) {
          updateStormCloud(o, dt);
          o.y += o.fallSpeed * dt;
        } else if (isSatelliteType(o.type)) {
          updateSatellite(o, dt); // self-contained: owns its own vertical fall + any spin/drift
        } else if (isMeteorWaveType(o.type)) {
          updateMeteorObstacle(o, dt); // self-contained: owns its own vertical/horizontal movement + any stage timers
          if (o.type === 'meteorCracked' && o.stage === 'popped') {
            spawnMeteorFragments(o.x, o.y);
            state.obstacles.splice(i, 1);
            continue; // already removed — skip the generic cull check below
          }
        } else {
          o.y += o.speed * dt;
        }
        // A diagonal satellite / a meteor fragment deliberately drifts
        // un-clamped past the screen edge rather than sliding along it,
        // so both also need their own horizontal cull alongside the
        // shared vertical one.
        const driftedOffSide = (isSatelliteType(o.type) || o.type === 'meteorFragment')
          && (o.x < -o.drawSize * 2 || o.x > DESIGN_W + o.drawSize * 2);
        if (o.y > DESIGN_H + o.drawSize || driftedOffSide) state.obstacles.splice(i, 1);
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
        if (isBirdType(o.type)) { drawBirdObstacle(ctx, o); return; } // real sprite, own sizing — no canvas-shape scale trick
        if (isStormCloudType(o.type)) { drawStormCloud(ctx, o); return; }
        if (isSatelliteType(o.type)) { drawSatellite(ctx, o); return; }
        if (isMeteorWaveType(o.type)) { drawMeteorObstacle(ctx, o); return; }
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
    btnStartLaunch.textContent = 'Start Launch';
    requestAnimationFrame(loop);
  }
  init();
})();
