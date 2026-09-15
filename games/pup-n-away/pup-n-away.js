// ===== Pup N Away — bootstrap: state machine, main loop, renderer =====
//
// Ties every other module together. Nothing else in the codebase should
// need to change to add a new level, collectible type or animation pose
// — all of that lives in pup-n-away-config.js and is read by the
// dedicated modules loaded before this file.
(function () {
  const CFG = window.PNA_CONFIG;
  const STATES = Object.freeze({
    LOADING: 'LOADING', TITLE: 'TITLE', INTRO: 'INTRO', COUNTDOWN: 'COUNTDOWN',
    PLAYING: 'PLAYING', LIFE_LOST: 'LIFE_LOST', LEVEL_COMPLETE: 'LEVEL_COMPLETE',
    GAME_OVER: 'GAME_OVER', PAUSED: 'PAUSED'
  });

  const canvas = document.getElementById('pna-canvas');
  const ctx = canvas.getContext('2d');
  const ui = window.PNA_UI.createUIManager();
  const audio = window.PNA_Audio.createAudioManager();
  const integration = window.PNA_Integration.createIntegration();
  const levels = window.PNA_Levels.createLevelManager();
  const input = window.PNA_Input.createInputManager(canvas, CFG.DESIGN_W, CFG.DESIGN_H);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let images = {};
  let state = STATES.LOADING;
  let stateBeforePause = STATES.TITLE;
  let basket = null;
  let dog = null;
  let collectibles = null;
  let currentLevel = null;

  const run = {
    score: 0,
    lives: CFG.PHYSICS.startingLives,
    bounces: 0,
    bonesThisRun: 0,
    playtimeStart: 0,
    introSeen: false
  };

  let countdownValue = 3;
  let countdownTimerMs = 0;
  let missTimerMs = 0;
  let returningToBasket = false;
  let levelOutcomeHandledPending = false;

  // ---------------------------------------------------------------
  // Canvas sizing — internal resolution tied to design coordinates,
  // scaled for the real device pixel ratio, independent from CSS size
  // (which the stylesheet keeps at a strict 16:9 letterboxed box).
  // ---------------------------------------------------------------
  function resizeCanvasForDPR() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    // Map the fixed 1920x1080 design space onto whatever the canvas's
    // real backing-store size is — every draw call below only ever
    // works in design coordinates.
    const scaleX = canvas.width / CFG.DESIGN_W;
    const scaleY = canvas.height / CFG.DESIGN_H;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  }
  window.addEventListener('resize', resizeCanvasForDPR);

  // ---------------------------------------------------------------
  // Level setup
  // ---------------------------------------------------------------
  function setupLevel(level) {
    currentLevel = level;
    basket = window.PNA_Basket.createBasket(images);
    basket.state.x = CFG.DESIGN_W / 2;
    dog = window.PNA_Dog.createDog(images, level);
    dog.state.y = basket.state.y - 14;
    dog.state.x = basket.state.x;
    dog.setGroundPosition(basket.state.x, basket.state.y - 6, 'right');
    collectibles = window.PNA_Collectibles.createCollectibleField(level, onBoneCollected);
    returningToBasket = false;
    run.bonesThisRun = 0;
    ui.updateHud({
      score: run.score, bonesCollected: 0, bonesTotal: collectibles.total,
      lives: run.lives, levelName: level.name
    });
  }

  function onBoneCollected(item, collectedCount, total) {
    run.score += collectibles.scoreForType(item.type);
    run.bonesThisRun++;
    audio.play(collectedCount >= total ? 'finalBoneCollected' : 'boneCollected');
    ui.updateHud({
      score: run.score, bonesCollected: collectedCount, bonesTotal: total,
      lives: run.lives, levelName: currentLevel.name
    });
    if (collectedCount >= total) {
      returningToBasket = true;
    }
  }

  // ---------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------
  function goTo(next) {
    state = next;
    const noOverlay = next === STATES.PLAYING || next === STATES.LIFE_LOST;
    ui.showScreen(noOverlay ? null : next);
    ui.setHudVisible(next === STATES.PLAYING || next === STATES.LIFE_LOST || next === STATES.PAUSED);
  }

  function startCountdown() {
    countdownValue = 3;
    countdownTimerMs = 0;
    ui.setCountdownText(String(countdownValue));
    goTo(STATES.COUNTDOWN);
  }

  function beginRun() {
    run.score = 0;
    run.lives = CFG.PHYSICS.startingLives;
    run.bounces = 0;
    run.playtimeStart = performance.now();
    levels.reset();
    setupLevel(levels.current());
    integration.gameStarted();
    if (run.introSeen || reduceMotion) {
      startCountdown();
    } else {
      goTo(STATES.INTRO);
    }
  }

  function launchDogFromBasket() {
    dog.state.grounded = false;
    const start = currentLevel.dogStart;
    dog.launch(start.vx, start.vy);
    dog.state.x = basket.state.x;
    dog.state.y = basket.state.y - dog.state.radius - 2;
    dog.state.justBounced = true;
  }

  function beginLevel() {
    goTo(STATES.PLAYING);
    audio.startMusic();
    launchDogFromBasket();
  }

  function handleMiss() {
    if (state !== STATES.PLAYING) return;
    run.lives--;
    audio.play('lostLife');
    ui.flashMissBanner();
    ui.updateHud({
      score: run.score, bonesCollected: collectibles.collectedCount(), bonesTotal: collectibles.total,
      lives: run.lives, levelName: currentLevel.name
    });
    goTo(STATES.LIFE_LOST);
    missTimerMs = CFG.PHYSICS.missResetDelayMs;
    if (run.lives <= 0) {
      // handled once the short delay finishes, in update()
    }
  }

  async function finishRunToGameOver() {
    goTo(STATES.GAME_OVER);
    audio.play('gameOver');
    ui.setGameOverPanel({ score: run.score });
    await saveRunResults(false);
  }

  async function saveRunResults(completed) {
    const playtimeSeconds = (performance.now() - run.playtimeStart) / 1000;
    await integration.saveScoreResult(run.score);
    await integration.recordProgress({
      levelReached: levels.currentNumber(),
      bonesCollected: run.bonesThisRun,
      bounces: run.bounces,
      playtimeSeconds,
      completed
    });
  }

  async function completeLevel() {
    audio.play('levelComplete');
    ui.setLevelCompletePanel({
      levelName: currentLevel.name,
      score: run.score,
      bonesCollected: collectibles.collectedCount(),
      bonesTotal: collectibles.total,
      isFinalLevel: levels.isLastLevel()
    });
    goTo(STATES.LEVEL_COMPLETE);
    await saveRunResults(levels.isLastLevel());
  }

  function runDogOffscreen(dt) {
    const dir = dog.state.x < CFG.DESIGN_W / 2 ? -1 : 1;
    dog.state.facing = dir > 0 ? 'right' : 'left';
    dog.state.x += dir * CFG.PHYSICS.dogRunSpeed * dt;
    dog.updateRunAnimation(dt);
    if (dog.state.x < -220 || dog.state.x > CFG.DESIGN_W + 220) {
      if (!levelOutcomeHandledPending) {
        levelOutcomeHandledPending = true;
        completeLevel();
      }
    }
  }

  // ---------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------
  function update(dt) {
    if (state === STATES.COUNTDOWN) {
      countdownTimerMs += dt * 1000;
      if (countdownTimerMs >= 700) {
        countdownTimerMs = 0;
        countdownValue--;
        if (countdownValue <= 0) {
          beginLevel();
        } else {
          ui.setCountdownText(String(countdownValue));
        }
      }
      return;
    }

    if (state === STATES.LIFE_LOST) {
      missTimerMs -= dt * 1000;
      if (missTimerMs <= 0) {
        if (run.lives <= 0) {
          finishRunToGameOver();
        } else {
          goTo(STATES.PLAYING);
          launchDogFromBasket();
        }
      }
      return;
    }

    if (state !== STATES.PLAYING) return;

    basket.update(dt, input.state);

    if (dog.state.grounded) {
      runDogOffscreen(dt);
      return;
    }

    const before = dog.state.vy;
    const result = window.PNA_Physics.stepDog(dog.state, dt, {
      x: basket.state.x, y: basket.state.y, width: basket.state.width, height: basket.state.height, vx: basket.state.vx
    }, dog.state.radius);
    dog.state.x = result.x; dog.state.y = result.y;
    dog.state.vx = result.vx; dog.state.vy = result.vy;
    dog.state.justBounced = result.justBounced;

    if (result.bounced) {
      run.bounces++;
      basket.squash();
      dog.onBasketImpact();
      audio.play('basketBounce');
      if (returningToBasket) {
        // safe landing after the final bone — play the landing beat,
        // then hand off to the run-off-screen outro.
        dog.setGroundPosition(basket.state.x, basket.state.y - 6, dog.state.facing);
        levelOutcomeHandledPending = false;
      }
    } else if (result.hitWall && Math.abs(before - dog.state.vy) > 1) {
      dog.onWallImpact();
      audio.play('wallBounce');
    }

    dog.update(dt);
    collectibles.update(dt, dog.state);

    if (result.missed) {
      handleMiss();
    }
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  function drawBackground() {
    const key = levels.backgroundKey(currentLevel);
    const img = images[key];
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (img) {
      ctx.drawImage(img, 0, 0, CFG.DESIGN_W, CFG.DESIGN_H);
    } else {
      ctx.fillStyle = '#0a0e1e';
      ctx.fillRect(0, 0, CFG.DESIGN_W, CFG.DESIGN_H);
    }
  }

  function render() {
    ctx.clearRect(0, 0, CFG.DESIGN_W, CFG.DESIGN_H);
    if (state === STATES.LOADING) return;
    if (!currentLevel) return;

    drawBackground();
    if (basket) basket.draw(ctx);
    if (collectibles) collectibles.draw(ctx, images);
    if (dog) dog.draw(ctx, images);
  }

  // ---------------------------------------------------------------
  // Main loop — requestAnimationFrame + delta time, clamped so a tab
  // coming back from being backgrounded doesn't apply a huge physics
  // step all at once.
  // ---------------------------------------------------------------
  let lastTime = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    resizeCanvasForDPR();
    if (!lastTime) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 1 / 20); // clamp worst-case step

    if (state !== STATES.PAUSED && state !== STATES.LOADING) {
      update(dt);
    }
    render();
  }

  // ---------------------------------------------------------------
  // Pause / resume — tab visibility, window blur, and the pause button
  // all funnel through the same pair of functions. Unlike Anagram
  // Quest's anti-cheat rule, losing focus never ENDS the run here —
  // it's a live physics arcade game, not a timed word round.
  // ---------------------------------------------------------------
  function pauseGame() {
    if (state === STATES.PAUSED || state === STATES.LOADING || state === STATES.TITLE
      || state === STATES.LEVEL_COMPLETE || state === STATES.GAME_OVER) return;
    stateBeforePause = state;
    goTo(STATES.PAUSED);
    audio.stopMusic();
  }
  function resumeGame() {
    if (state !== STATES.PAUSED) return;
    goTo(stateBeforePause);
    if (stateBeforePause === STATES.PLAYING) audio.startMusic();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', pauseGame);

  // ---------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------
  function wireButtons() {
    ui.bindButton('pna-btn-start', () => { audio.unlockOnFirstGesture(); audio.play('buttonClick'); beginRun(); });
    ui.bindButton('pna-btn-skip-intro', () => { audio.play('buttonClick'); run.introSeen = true; startCountdown(); });
    ui.bindButton('pna-btn-continue', () => {
      audio.play('buttonClick');
      if (levels.isLastLevel()) {
        window.location.href = '../../index.html';
      } else {
        setupLevel(levels.advance());
        startCountdown();
      }
    });
    ui.bindButton('pna-btn-replay-level', () => { audio.play('buttonClick'); setupLevel(levels.current()); startCountdown(); });
    ui.bindButton('pna-btn-return-lc', () => { window.location.href = '../../index.html'; });
    ui.bindButton('pna-btn-restart-level-go', () => {
      audio.play('buttonClick');
      // Game Over already recorded the finished run — restarting here
      // begins a genuinely fresh run (score/bounces/lives reset), not a
      // continuation of the run that just ended.
      run.score = 0;
      run.lives = CFG.PHYSICS.startingLives;
      run.bounces = 0;
      run.playtimeStart = performance.now();
      setupLevel(levels.current());
      integration.gameStarted();
      startCountdown();
    });
    ui.bindButton('pna-btn-return-go', () => { window.location.href = '../../index.html'; });
    ui.bindButton('pna-btn-pause', () => { audio.play('buttonClick'); pauseGame(); });
    ui.bindButton('pna-btn-resume', () => { audio.play('buttonClick'); resumeGame(); });
    ui.bindButton('pna-btn-restart-paused', () => { audio.play('buttonClick'); run.lives = CFG.PHYSICS.startingLives; setupLevel(levels.current()); startCountdown(); });
    ui.bindButton('pna-btn-return-paused', () => { window.location.href = '../../index.html'; });
    ui.bindButton('pna-btn-mute', () => {
      const muted = audio.toggleMuted();
      ui.setMuteButtonState(muted);
    });
    ui.bindButton('pna-btn-fullscreen', () => {
      const wrap = document.getElementById('pna-stage-wrap');
      if (!document.fullscreenElement) wrap.requestFullscreen && wrap.requestFullscreen();
      else document.exitFullscreen && document.exitFullscreen();
    });

    window.addEventListener('keydown', () => { /* any key counts toward unlocking audio autoplay */ audio.unlockOnFirstGesture(); }, { once: true });
    canvas.addEventListener('pointerdown', () => { audio.unlockOnFirstGesture(); }, { once: true });
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  async function boot() {
    resizeCanvasForDPR();
    wireButtons();
    ui.showScreen('LOADING');

    const result = await window.PNA_Assets.loadAll((done, total) => ui.setLoadingProgress(done, total));
    images = result.images;
    if (window.PNA_DEV_MODE && result.missing.length) {
      console.warn('[Pup N Away] ' + result.missing.length + ' asset(s) missing:', result.missing);
    }

    await integration.init();

    goTo(STATES.TITLE);
    requestAnimationFrame(loop);
  }

  boot();

  // exposed for manual QA only (e.g. driving frames in an automated
  // preview tool where requestAnimationFrame does not fire) — never
  // used by the normal game loop above.
  window.PNA_DEBUG = {
    get state() { return state; }, STATES, run,
    pump(dtSeconds) { resizeCanvasForDPR(); update(dtSeconds); render(); },
    goTo, ui,
    get dog() { return dog; }, get basket() { return basket; }, get collectibles() { return collectibles; }
  };
})();
