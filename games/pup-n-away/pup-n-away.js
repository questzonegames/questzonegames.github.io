// ===== Pup N Away — bootstrap: state machine, main loop, renderer =====
//
// Ties every other module together. Nothing else in the codebase should
// need to change to add a new level, collectible type or animation pose
// — all of that lives in pup-n-away-config.js and is read by the
// dedicated modules loaded before this file.
(function () {
  const CFG = window.PNA_CONFIG;
  const STATES = Object.freeze({
    LOADING: 'LOADING', LOBBY: 'LOBBY', LEVEL_SELECT: 'LEVEL_SELECT',
    CHALLENGES: 'CHALLENGES', EQUIPMENT: 'EQUIPMENT', COUNTDOWN: 'COUNTDOWN',
    PLAYING: 'PLAYING', LIFE_LOST: 'LIFE_LOST', LEVEL_COMPLETE: 'LEVEL_COMPLETE',
    GAME_OVER: 'GAME_OVER', PAUSED: 'PAUSED'
  });
  // Lobby music plays across every menu screen (not just the literal
  // Lobby) and stops the instant PLAYING/COUNTDOWN/etc. begins — see
  // goTo() below.
  const MENU_STATES = new Set([STATES.LOBBY, STATES.LEVEL_SELECT, STATES.CHALLENGES, STATES.EQUIPMENT]);

  const canvas = document.getElementById('pna-canvas');
  const ctx = canvas.getContext('2d');
  const ui = window.PNA_UI.createUIManager();
  const audio = window.PNA_Audio.createAudioManager();
  const integration = window.PNA_Integration.createIntegration();
  const levels = window.PNA_Levels.createLevelManager();
  const input = window.PNA_Input.createInputManager(canvas, CFG.DESIGN_W, CFG.DESIGN_H);
  const menus = window.PNA_Menus.createMenuManager({
    levels, integration, audio,
    onSelectLevel: (levelId) => { transitionToLevel(levelId); },
    onReturnToLobby: () => { goTo(STATES.LOBBY); }
  });
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Coarse-pointer (touch) devices are treated as "mobile" for perf
  // purposes — a lower canvas backing-store resolution and cheaper
  // image resampling are the two biggest, cheapest wins against jank
  // on a phone GPU, and neither is visually missed at phone viewing
  // distance/size. window.PNA_MOBILE is also read by every other
  // module's own draw() (dog/basket/collectibles) so the smoothing
  // quality choice stays consistent everywhere in one place.
  const isMobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  window.PNA_MOBILE = isMobile;

  // ---------------------------------------------------------------
  // Music/Sound volume preferences — localStorage (instant, works
  // signed out) + account sync via the same generic, game-agnostic
  // public.user_audio_settings table Anagram Quest already uses
  // (keyed by user_id + game_key, RLS lets a player read/write only
  // their own row directly, no RPC needed since a volume preference
  // isn't something worth cheating). See wireAudioControls() below for
  // the popover UI that drives this.
  // ---------------------------------------------------------------
  const AUDIO_GAME_SLUG = 'pup-n-away';
  const PNAAudioPrefs = (function () {
    function loadLocalPct(key, fallback) {
      try {
        const saved = localStorage.getItem(key);
        if (saved !== null) return Math.max(0, Math.min(100, parseInt(saved, 10)));
      } catch (e) { /* localStorage unavailable — fall through to default */ }
      return fallback;
    }
    function saveLocalPct(key, pct) {
      try { localStorage.setItem(key, String(pct)); } catch (e) { /* ignore */ }
    }

    let sfxPct = loadLocalPct('pna-sfx-volume', 70);
    let musicPct = loadLocalPct('pna-music-volume', 50);
    audio.setSfxVolume(sfxPct / 100);
    audio.setMusicVolume(musicPct / 100);

    let saveTimer = null;
    function debouncedAccountSave() {
      if (!window.QZAuth || !window.QZAuth.client || !integration.profile) return;
      clearTimeout(saveTimer);
      // A slider fires many 'input' events per drag — debounce the
      // network write so dragging doesn't spam upserts.
      saveTimer = setTimeout(() => {
        window.QZAuth.client
          .from('user_audio_settings')
          .upsert({ user_id: integration.profile.id, game_key: AUDIO_GAME_SLUG, music_volume: musicPct, sfx_volume: sfxPct, updated_at: new Date().toISOString() }, { onConflict: 'user_id,game_key' })
          .then(({ error }) => { if (error) console.warn('Pup N Away: could not save audio settings', error); });
      }, 500);
    }

    function setSfxPct(pct) {
      sfxPct = Math.max(0, Math.min(100, pct));
      audio.setSfxVolume(sfxPct / 100);
      saveLocalPct('pna-sfx-volume', sfxPct);
      debouncedAccountSave();
    }
    function setMusicPct(pct) {
      musicPct = Math.max(0, Math.min(100, pct));
      audio.setMusicVolume(musicPct / 100);
      saveLocalPct('pna-music-volume', musicPct);
      debouncedAccountSave();
    }

    // Pulls this player's saved row (if any) once signed in, overriding
    // whatever localStorage/defaults already applied on this page load.
    // A first-time sign-in writes the current local values up as that
    // row's starting point instead of leaving the account with none.
    async function loadFromAccount() {
      const client = window.QZAuth && window.QZAuth.client;
      const userId = integration.profile && integration.profile.id;
      if (!client || !userId) return;
      try {
        const { data, error } = await client
          .from('user_audio_settings').select('music_volume,sfx_volume')
          .eq('user_id', userId).eq('game_key', AUDIO_GAME_SLUG).maybeSingle();
        if (error) { console.warn('Pup N Away: could not load audio settings', error); return; }
        if (data) {
          if (typeof data.sfx_volume === 'number') { sfxPct = data.sfx_volume; audio.setSfxVolume(sfxPct / 100); saveLocalPct('pna-sfx-volume', sfxPct); }
          if (typeof data.music_volume === 'number') { musicPct = data.music_volume; audio.setMusicVolume(musicPct / 100); saveLocalPct('pna-music-volume', musicPct); }
        } else {
          await client.from('user_audio_settings')
            .upsert({ user_id: userId, game_key: AUDIO_GAME_SLUG, music_volume: musicPct, sfx_volume: sfxPct }, { onConflict: 'user_id,game_key' });
        }
      } catch (err) {
        console.warn('Pup N Away: could not load audio settings', err);
      }
    }

    return { getSfxPct: () => sfxPct, getMusicPct: () => musicPct, setSfxPct, setMusicPct, loadFromAccount };
  })();

  let images = {};
  let state = STATES.LOADING;
  let stateBeforePause = STATES.LOBBY;
  let basket = null;
  let dog = null;
  let collectibles = null;
  let currentLevel = null;
  let editor = null;
  // Playtest (Level Editor only) — a real run through the real physics/
  // state machine using the editor's current UNSAVED layout, but never
  // recorded: saveRunResults()/completeLevel()'s progression calls and
  // gameStarted() all check this flag and skip. See startPlaytest()
  // and goTo()'s own playtestMode handling below.
  let playtestMode = false;
  let playtestPriorOverride = null;

  const run = {
    score: 0,
    lives: CFG.PHYSICS.startingLives,
    bounces: 0,
    bonesThisRun: 0,
    playtimeStart: 0
  };

  let countdownValue = 3;
  let countdownTimerMs = 0;
  let missTimerMs = 0;
  let freezeRemainingMs = 0; // Freeze-Time Biscuit — remaining pause on the level clock, 0 = not active
  let returningToBasket = false;
  let levelOutcomeHandledPending = false;
  let levelElapsedMs = 0;   // resets each level; how long THIS attempt has taken so far

  // ---------------------------------------------------------------
  // Canvas sizing — internal resolution tied to design coordinates,
  // scaled for the real device pixel ratio, independent from CSS size
  // (which the stylesheet keeps at a strict 16:9 letterboxed box).
  // ---------------------------------------------------------------
  function resizeCanvasForDPR() {
    // Mobile GPUs pay for every extra backing-store pixel — capping at
    // 1x there (vs 2x on desktop) cuts the fill rate to a quarter with
    // no visible loss at phone viewing distance, and is the single
    // biggest lever against jank on a phone.
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 2);
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      // Resizing the canvas element resets ALL context state, including
      // smoothing — re-apply here (once per actual resize, not every
      // frame) rather than in every module's own draw() call.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = isMobile ? 'low' : 'high';
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
    basket.state.x = (level.basketStart && typeof level.basketStart.x === 'number') ? level.basketStart.x : CFG.DESIGN_W / 2;
    dog = window.PNA_Dog.createDog(images, level);
    dog.state.y = basket.state.y - 14;
    dog.state.x = basket.state.x;
    dog.setGroundPosition(basket.state.x, basket.state.y - 6, 'right');
    collectibles = window.PNA_Collectibles.createCollectibleField(level, onBoneCollected);
    returningToBasket = false;
    run.bonesThisRun = 0;
    // Every level is a fresh attempt: three lives and the clock back to
    // zero, regardless of how the previous level or run went.
    run.lives = CFG.PHYSICS.startingLives;
    levelElapsedMs = 0;
    freezeRemainingMs = 0;
    ui.setFreezeIndicator(null);
    ui.updateHud({
      score: run.score, bonesCollected: 0, bonesTotal: collectibles.total,
      lives: run.lives, levelName: level.name
    });
    ui.setTimerText(0);
  }

  // Branches on the collected item's `kind` (see PNA_CONFIG.COLLECTIBLE_
  // TYPES) — 'required' (a real Dream Bone) is the exact original
  // behavior, unchanged; the other four are this round's new pickups.
  // None of the four ever touch dog/basket position or velocity, the
  // bounce in progress, collected-bones count, or the level's required
  // total — only their own specific side effect.
  function onBoneCollected(item, collectedCount, total) {
    const typeDef = CFG.COLLECTIBLE_TYPES[item.type];
    let triggerGameOver = false;
    switch (typeDef.kind) {
      case 'bonusScore': // Golden Dream Bone
        run.score += typeDef.points;
        audio.play('powerup');
        ui.flashMissBanner('+' + typeDef.points, 'bonus');
        break;
      case 'extraLife': // Golden Heart Biscuit
        run.lives++;
        audio.play('extraLife');
        break;
      case 'loseLife': // Nightmare Bone — dog keeps flying; only lives change
        run.lives--;
        audio.play('nightmareBone');
        ui.flashMissBanner('NIGHTMARE!', 'nightmare');
        if (run.lives <= 0) triggerGameOver = true;
        break;
      case 'freezeTimer': // Freeze-Time Biscuit — stacks onto any active freeze
        freezeRemainingMs += (typeDef.freezeSeconds || 5) * 1000;
        ui.setFreezeIndicator(Math.ceil(freezeRemainingMs / 1000));
        audio.play('freezeTime');
        break;
      default: // 'required' — a real Dream Bone
        run.score += typeDef.points;
        run.bonesThisRun++;
        audio.play(collectedCount >= total ? 'finalBoneCollected' : 'boneCollected');
        if (collectedCount >= total) returningToBasket = true;
    }
    ui.updateHud({
      score: run.score, bonesCollected: collectedCount, bonesTotal: total,
      lives: run.lives, levelName: currentLevel.name
    });
    // Uses the existing Game Over path exactly as a normal miss would —
    // but never goes through handleMiss()/LIFE_LOST, so the dog is
    // never repositioned or interrupted first.
    if (triggerGameOver) finishRunToGameOver();
  }

  // ---------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------
  function goTo(next) {
    const prev = state;
    state = next;
    // Any exit to the Lobby while a Playtest is running is treated as
    // "exit playtest" — restores whatever layout override existed
    // before the playtest started (so a later, real, non-editor play
    // session never sees playtest-only unsaved data) and reopens the
    // editor exactly where the admin left it, unsaved changes intact.
    let reopenEditorAfterThisGoTo = false;
    if (next === STATES.LOBBY && playtestMode) {
      playtestMode = false;
      const levelId = currentLevel && currentLevel.id;
      if (levelId) {
        if (playtestPriorOverride) levels.setLevelOverride(levelId, playtestPriorOverride);
        else levels.clearLevelOverride(levelId);
      }
      playtestPriorOverride = null;
      reopenEditorAfterThisGoTo = true;
    }
    const noOverlay = next === STATES.PLAYING || next === STATES.LIFE_LOST;
    ui.showScreen(noOverlay ? null : next);
    ui.setHudVisible(next === STATES.PLAYING || next === STATES.LIFE_LOST || next === STATES.PAUSED);

    // Lobby music plays across every menu screen (Lobby/Level Select/
    // Challenges/Equipment) — starts the moment it's allowed to (an
    // unlocked gesture) on entering any of them, stops the instant
    // gameplay (or anything else) begins.
    const wasMenu = MENU_STATES.has(prev);
    const isMenu = MENU_STATES.has(next);
    if (isMenu && !wasMenu) audio.startLobbyMusic();
    else if (wasMenu && !isMenu) audio.stopLobbyMusic();

    // pna-btn-start uses bindButtonOnce() (see wireButtons()) so a rapid
    // double-tap can never fire startGame() twice — re-enable it every
    // time the player is actually back on the Lobby screen to see it.
    if (next === STATES.LOBBY) {
      const startBtn = document.getElementById('pna-btn-start');
      if (startBtn) startBtn.disabled = false;
    }

    const playtestBar = document.getElementById('pna-editor-playtest-bar');
    if (playtestBar) playtestBar.classList.toggle('pna-editor-active', playtestMode);
    if (reopenEditorAfterThisGoTo && editor) {
      const reopenLevelId = currentLevel && currentLevel.id;
      editor.open({ reopenLevelId });
    }
  }

  function startCountdown() {
    countdownValue = 3;
    countdownTimerMs = 0;
    ui.setCountdownText(String(countdownValue));
    goTo(STATES.COUNTDOWN);
  }

  // Finds the furthest unlocked-but-not-yet-completed level for a
  // returning signed-in player (a brand new/signed-out player has no
  // completions, so this naturally resolves to Act 1 Level 1). If every
  // level is already completed, resumes at the last one (today's
  // "replay the latest content" behavior — there is no further act to
  // send them to yet).
  async function computeStartingLevelIndex() {
    return levels.firstLevelIndexOfAct(1);
  }

  // Shared by both "Start Game" (Lobby) and picking a level directly
  // (Level Select) — fades the currently visible menu screen out, then
  // jumps straight to the chosen level and runs the normal countdown.
  // There is no intro/"Skip Intro" screen in this flow at all anymore.
  let levelTransitionInFlight = false;
  function transitionToLevel(levelIndexOrId) {
    if (levelTransitionInFlight) return; // guards against a level-select card double-click, or Start Game racing a card pick
    levelTransitionInFlight = true;
    function doStart() {
      levelTransitionInFlight = false;
      if (typeof levelIndexOrId === 'number') levels.goToIndex(levelIndexOrId);
      else levels.goToLevelId(levelIndexOrId);
      run.score = 0;
      run.bounces = 0;
      run.playtimeStart = performance.now();
      setupLevel(levels.current());
      if (!playtestMode) integration.gameStarted();
      startCountdown();
    }
    const activeScreen = document.querySelector('.pna-overlay:not(.hidden)');
    if (reduceMotion || !activeScreen) { doStart(); return; }
    activeScreen.classList.add('pna-fading-out');
    setTimeout(() => { activeScreen.classList.remove('pna-fading-out'); doStart(); }, 350);
  }

  // Level Editor's Playtest button — a REAL run through the real state
  // machine/physics using the editor's current unsaved layout (never
  // what's actually published), with progression/score/XP recording
  // fully suppressed (see playtestMode's other check sites) and never
  // publishing or saving anything itself.
  function startPlaytest(levelId, fields) {
    playtestPriorOverride = levels.getLevelOverride(levelId);
    levels.setLevelOverride(levelId, fields);
    playtestMode = true;
    transitionToLevel(levelId);
  }

  async function startGame() {
    const startIndex = await computeStartingLevelIndex();
    transitionToLevel(startIndex);
  }

  // Called both at the true start of a level (from beginLevel()) AND to
  // respawn after a missed catch (from update()'s LIFE_LOST branch) —
  // the SAME reset every time, on purpose: the basket is forced back to
  // the level's real centred starting position (never wherever it
  // happened to be drifted to when the dog was missed) before the dog
  // launches from it, so a life lost while the basket is parked under a
  // hard bone can never be used as a free respawn-and-catch shortcut.
  function launchDogFromBasket() {
    basket.state.x = (currentLevel.basketStart && typeof currentLevel.basketStart.x === 'number')
      ? currentLevel.basketStart.x : CFG.DESIGN_W / 2;
    basket.state.vx = 0;
    basket.state.squashTimer = 0;

    dog.state.grounded = false;
    const start = currentLevel.dogStart;
    dog.launch(start.vx, start.vy); // also zeroes bounceCharge/tuckRotation
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

  // The score shown here is already effectively "frozen" — run.score
  // simply stops changing the instant state leaves PLAYING (update()'s
  // gameplay branch, the only place it's ever incremented, early-
  // returns for every other state) — so reading it here IS the
  // snapshot, not a race against something still ticking.
  async function finishRunToGameOver() {
    goTo(STATES.GAME_OVER);
    audio.play('gameOver');
    ui.setGameOverPanel({ score: run.score });
    await saveRunResults(false);
  }

  async function saveRunResults(completed) {
    if (playtestMode) return; // Playtest never touches score/progression/XP
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
    const isFinalOfAct = levels.isFinalLevelOfAct();
    // Frozen once, here — nothing later can change what the panel
    // shows, since setupLevel()/beginRun() (the only things that reset
    // score/bones/timer) are never called again until the player picks
    // Continue or Restart Act.
    ui.setLevelCompletePanel({
      levelName: currentLevel.name,
      score: run.score,
      bonesCollected: collectibles.collectedCount(),
      bonesTotal: collectibles.total,
      timeMs: levelElapsedMs
    });
    goTo(STATES.LEVEL_COMPLETE);
    await saveRunResults(isFinalOfAct);
    if (playtestMode) return; // Playtest never touches progression/unlocks
    // Powers Level Select's sequential unlock/replay logic — a stricter,
    // separate fact from the "reached" stat saveRunResults() above just
    // recorded (see 20260918010000_pup_n_away_level_progress.sql).
    await integration.recordLevelComplete(currentLevel.id, run.score, levelElapsedMs);
    if (isFinalOfAct) {
      // Recorded as soon as the act is genuinely finished, independent
      // of whether/when the player clicks Continue — the server is
      // still the one deciding whether this unlock is legitimate (see
      // record_pup_n_away_act_complete()), this just reports it.
      await integration.recordActComplete(currentLevel.act);
    }
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
      // Timer pauses the instant a life is lost and picks back up (not
      // reset) once the dog relaunches — it never counts the miss delay.
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

    // Freeze-Time Biscuit — ONLY the level clock pauses; everything
    // below this (basket, dog physics, collectibles, HUD lives/score)
    // keeps running completely normally.
    if (freezeRemainingMs > 0) {
      freezeRemainingMs = Math.max(0, freezeRemainingMs - dt * 1000);
      const secondsLeft = Math.ceil(freezeRemainingMs / 1000);
      if (freezeRemainingMs <= 0) ui.setFreezeIndicator(null);
      else ui.setFreezeIndicator(secondsLeft);
    } else {
      levelElapsedMs += dt * 1000;
    }
    ui.setTimerText(levelElapsedMs);

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
      // restart:true — a rapid-fire corner-trap bounce cuts the still-
      // playing "boing" off and replays it from the top instead of
      // layering a second copy on top (never echoes/stacks).
      audio.play('basketBounce', { restart: true });
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
    // Smoothing is set once, in resizeCanvasForDPR(), whenever the
    // canvas backing store actually changes size — no need to redo it
    // on every draw call/module.
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

    // Level Editor owns the canvas/frame entirely while open — dog
    // physics, timers, scoring, bone collection and lives never run in
    // Edit Mode (see PNA_Editor.tick(), which does its own drawing).
    if (editor && editor.isOpen()) { editor.tick(dt); return; }

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
    if (state === STATES.PAUSED || state === STATES.LOADING || MENU_STATES.has(state)
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
    menus.positionLobbyHotspots();

    // ---- Lobby's 5 buttons — real hitboxes over the supplied art's own
    // baked button labels (see the .pna-ui-hotspot rules in index.html
    // and PNA_CONFIG.UI_HOTSPOTS.lobby for their measured positions). No
    // intro/"Skip Intro" screen exists anymore — Start Game fades
    // straight into gameplay. bindButtonOnce() so a rapid double-tap on
    // Start Game (or a level card) can never load two levels/countdowns
    // at once.
    ui.bindButtonOnce('pna-btn-start', () => { audio.unlockOnFirstGesture(); audio.play('buttonClick'); startGame(); });
    ui.bindButton('pna-lobby-btn-level-select', () => { audio.play('buttonClick'); menus.refreshLevelSelect(); goTo(STATES.LEVEL_SELECT); });
    ui.bindButton('pna-lobby-btn-challenges', () => { audio.play('buttonClick'); menus.refreshChallenges(); goTo(STATES.CHALLENGES); });
    ui.bindButton('pna-lobby-btn-equipment', () => { audio.play('buttonClick'); menus.refreshEquipment(); goTo(STATES.EQUIPMENT); });
    ui.bindButton('pna-lobby-btn-return-home', () => {
      audio.play('buttonClick');
      audio.stopLobbyMusic();
      window.location.href = '../../index.html';
    });
    // Level Editor's floating Playtest-mode control — goTo(LOBBY)'s own
    // playtestMode handling (see above) does the actual "exit playtest,
    // restore the prior override, reopen the editor" work; this button
    // just triggers it, same as reaching Game Over/Level Complete and
    // clicking their own Return to Lobby buttons during a playtest.
    ui.bindButton('pna-editor-exit-playtest', () => {
      audio.play('buttonClick');
      goTo(STATES.LOBBY);
    });

    // Result-panel buttons use bindButtonOnce() — disabled the instant
    // they're clicked (re-enabled next time that panel is freshly
    // populated) so a rapid double-tap can never fire the navigation/
    // progression-saving handler twice.
    ui.bindButtonOnce('pna-btn-continue', () => {
      audio.play('buttonClick');
      // The act-complete save already happened in completeLevel() the
      // instant the level ended — this button only ever decides where
      // to go next. "Pup N Away lobby" is the title screen: with only
      // one act's worth of content today there's nothing yet to choose
      // between, so returning there (never the Quest Zone homepage) is
      // what "return to lobby" means until a real act-select screen has
      // something to select.
      if (levels.isFinalLevelOfAct()) {
        goTo(STATES.LOBBY);
      } else {
        setupLevel(levels.advance());
        startCountdown();
      }
    });
    ui.bindButtonOnce('pna-btn-return-lc', () => {
      audio.play('buttonClick');
      audio.stopMusic();
      goTo(STATES.LOBBY);
    });
    ui.bindButtonOnce('pna-btn-restart-act', () => {
      audio.play('buttonClick');
      // Restarts the ACT the player died in, not just the level — find
      // that act from the level they were actually on (frozen in
      // currentLevel since Game Over), jump to its first level, and
      // reset every per-run value a fresh attempt should start with.
      // Permanently unlocked acts (recorded server-side already) are
      // never touched here.
      run.score = 0;
      run.bounces = 0;
      run.playtimeStart = performance.now();
      levels.goToActStart(currentLevel.act);
      setupLevel(levels.current());
      if (!playtestMode) integration.gameStarted();
      startCountdown();
    });
    ui.bindButtonOnce('pna-btn-return-go', () => {
      audio.play('buttonClick');
      audio.stopMusic();
      goTo(STATES.LOBBY);
    });
    // Manual pause/fullscreen buttons were removed from the toolbar
    // (redesigned around the supplied artwork, which has no room for
    // them) and are being reintroduced elsewhere separately later —
    // auto-pause on tab-hidden/window-blur (see pauseGame() below)
    // still works, and the Paused screen's own Resume/Restart/Return
    // buttons stay fully functional for whenever that screen is up.
    ui.bindButton('pna-btn-resume', () => { audio.play('buttonClick'); resumeGame(); });
    ui.bindButton('pna-btn-restart-paused', () => { audio.play('buttonClick'); setupLevel(levels.current()); startCountdown(); });
    ui.bindButton('pna-btn-return-paused', () => { window.location.href = '../../index.html'; });

    // Listen as widely as possible for the very first gesture — the
    // title screen's own overlay sits on top of the canvas, so a click
    // on it (anywhere, not just the Play button) never reaches the
    // canvas-only listener below; a page-level listener catches that
    // too, so lobby music starts the instant ANY interaction happens.
    window.addEventListener('keydown', unlockAudioAndMaybeStartLobbyMusic, { once: true });
    document.addEventListener('pointerdown', unlockAudioAndMaybeStartLobbyMusic, { once: true });
  }

  // ---------------------------------------------------------------
  // Mobile move buttons — the game is keyboard-only by design, which
  // otherwise leaves touch devices with no way to move the basket at
  // all. These two big buttons (hidden on desktop, see index.html's
  // #pna-move-controls media query) sit below the toolbar and just
  // hold the same left/right flags a held key would — basket.update()
  // doesn't know or care whether input.state.left came from a key or
  // a held button.
  // ---------------------------------------------------------------
  function wireHoldButton(el, onDown, onUp) {
    if (!el) return;
    // Pointer Events cover modern mobile browsers, but a duplicate,
    // explicit Touch Event path is wired alongside them (both call the
    // same onDown/onUp, which are idempotent — setting the same
    // left/right flag twice is harmless) so a real phone still works
    // even if something about its Pointer Event support is flaky.
    // preventDefault on every path stops iOS's own text-selection/
    // callout gesture from grabbing the touch instead of the button —
    // that gesture was both showing the "copy/paste" highlight AND
    // swallowing the touch so the basket never moved.
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
    el.addEventListener('pointerup', (e) => { e.preventDefault(); onUp(); });
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
    el.addEventListener('touchcancel', onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function wireMoveButtons() {
    wireHoldButton(document.getElementById('pna-btn-move-left'),
      () => { input.state.left = true; }, () => { input.state.left = false; });
    wireHoldButton(document.getElementById('pna-btn-move-right'),
      () => { input.state.right = true; }, () => { input.state.right = false; });
  }

  function unlockAudioAndMaybeStartLobbyMusic() {
    // any gesture counts toward unlocking audio autoplay — if it
    // happens while we're still sitting on a menu screen, the lobby
    // music that couldn't play before now can.
    audio.unlockOnFirstGesture();
    if (MENU_STATES.has(state)) audio.startLobbyMusic();
  }

  // ---------------------------------------------------------------
  // Music/Sound popover — a fixed pair of icon buttons, always visible,
  // sharing one popover element that gets repositioned/relabelled by
  // whichever button was clicked. Same interaction pattern as Anagram
  // Quest's audio controls.
  // ---------------------------------------------------------------
  function wireAudioControls() {
    const popover = document.getElementById('pna-audio-popover');
    if (!popover) return; // markup not present (shouldn't happen, but never throw over a UI nicety)
    const titleEl = document.getElementById('pna-audio-popover-title');
    const sliderEl = document.getElementById('pna-audio-popover-slider');
    const valueEl = document.getElementById('pna-audio-popover-value');
    const noteEl = document.getElementById('pna-audio-popover-note');
    const buttons = Array.from(document.querySelectorAll('[data-audio-popover]'));

    let openKind = null; // 'music' | 'sound' | null
    let openBtn = null;

    function closePopover() {
      popover.classList.remove('show');
      popover.setAttribute('aria-hidden', 'true');
      buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
      openKind = null;
      openBtn = null;
    }

    function openPopover(kind, btn) {
      const isMusic = kind === 'music';
      titleEl.textContent = isMusic ? 'MUSIC' : 'SOUND';
      const pct = isMusic ? PNAAudioPrefs.getMusicPct() : PNAAudioPrefs.getSfxPct();
      sliderEl.value = pct;
      valueEl.textContent = pct;
      noteEl.textContent = isMusic
        ? 'Lobby and in-game background music.'
        : 'Basket bounces, bone pickups, buttons, and every other sound effect.';

      // These buttons live in the toolbar BELOW the game stage, so
      // opening the popover downward (the old behavior) routinely
      // pushed it past the bottom edge of the viewport. Open it upward
      // instead, and clamp both axes so it always stays fully on
      // screen regardless of window size or which button was clicked.
      const rect = btn.getBoundingClientRect();
      const margin = 8;
      const popW = 220; // matches .pna-audio-popover's fixed width
      const estimatedPopH = 140; // roughly the popover's real rendered height

      if (rect.top >= estimatedPopH + margin) {
        popover.style.bottom = (window.innerHeight - rect.top + margin) + 'px';
        popover.style.top = 'auto';
      } else {
        popover.style.top = (rect.bottom + margin) + 'px';
        popover.style.bottom = 'auto';
      }

      let right = window.innerWidth - rect.right;
      right = Math.max(margin, Math.min(right, window.innerWidth - popW - margin));
      popover.style.right = right + 'px';
      popover.style.left = 'auto';

      popover.classList.add('show');
      popover.setAttribute('aria-hidden', 'false');
      buttons.forEach((b) => b.setAttribute('aria-expanded', String(b === btn)));
      openKind = kind;
      openBtn = btn;
    }
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        unlockAudioAndMaybeStartLobbyMusic();
        const kind = btn.getAttribute('data-audio-popover');
        if (openKind === kind && openBtn === btn) { closePopover(); return; }
        openPopover(kind, btn);
      });
    });

    sliderEl.addEventListener('input', () => {
      const pct = parseInt(sliderEl.value, 10) || 0;
      valueEl.textContent = pct;
      if (openKind === 'sound') PNAAudioPrefs.setSfxPct(pct);
      else if (openKind === 'music') PNAAudioPrefs.setMusicPct(pct);
    });

    document.addEventListener('click', (e) => {
      if (!openKind) return;
      if (popover.contains(e.target)) return;
      if (buttons.some((b) => b.contains(e.target))) return;
      closePopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openKind) closePopover();
    });
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  async function boot() {
    resizeCanvasForDPR();
    wireButtons();
    wireAudioControls();
    wireMoveButtons();
    ui.showScreen('LOADING');

    const result = await window.PNA_Assets.loadAll((done, total) => ui.setLoadingProgress(done, total));
    images = result.images;
    if (window.PNA_DEV_MODE && result.missing.length) {
      console.warn('[Pup N Away] ' + result.missing.length + ' asset(s) missing:', result.missing);
    }

    await integration.init();
    PNAAudioPrefs.loadFromAccount(); // not awaited — applies live volume as soon as it resolves, doesn't block anything else here
    wireAdminDebugToggle();
    editor = window.PNA_Editor.createEditor({
      canvas, images, CFG, levels, integration, audio, ui, startPlaytest,
      resizeCanvasForDPR,
      onExitToLobby: () => goTo(STATES.LOBBY)
    });
    wireLevelEditorButton();
    await loadPublishedLevelOverrides();

    goTo(STATES.LOBBY);
    requestAnimationFrame(loop);
  }

  // Admin-only Level Editor launch button — same client-side gate as
  // wireAdminDebugToggle() below (profile.is_admin only controls
  // whether this button SHOWS; every actual editor read/write
  // re-checks public.is_admin() server-side via its RPC regardless —
  // see PNA_Editor.open() and pup-n-away-integration.js). A non-admin
  // never sees this button, and even if they called
  // window.PNA_DEBUG.editor.open() directly from devtools, the first
  // real data load inside it would fail server-side and bounce them
  // back to the Lobby (see open()'s silentIfForbidden handling).
  function wireLevelEditorButton() {
    const btn = document.getElementById('pna-btn-level-editor');
    if (!btn) return;
    const isAdmin = !!(integration.profile && integration.profile.is_admin);
    if (!isAdmin) return;
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      audio.play('buttonClick');
      await editor.open({});
    });
  }

  // Fetches each level's currently PUBLISHED editor layout (if any) once
  // at boot and installs it as a runtime override (see
  // levels.setLevelOverride()) — normal gameplay then plays that layout
  // through the exact same setupLevel()/collectibles/physics code path
  // as always, no separate implementation. A level with no published
  // row, or any failure here (offline, RLS, slow network), just plays
  // its bundled static PNA_CONFIG.LEVELS entry — the 4s-per-level
  // timeout guarantees this never meaningfully delays boot.
  async function loadPublishedLevelOverrides() {
    function withTimeout(p, ms) {
      return Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
    }
    await Promise.all(levels.all().map(async (level) => {
      try {
        const objects = await withTimeout(integration.getPublishedLevelObjects(level.id), 4000);
        if (objects) levels.setLevelOverride(level.id, levels.editorObjectsToLevelFields(objects));
      } catch (err) { /* level just plays its bundled static layout */ }
    }));
  }

  // ---------------------------------------------------------------
  // Admin-only hitbox debug toggle — a single button, visible only to
  // signed-in admins (integration.profile.is_admin, the same flag every
  // other admin-only Quest Zone UI already gates on), that turns on
  // BOTH the existing menu-hitbox outline mode (the same one
  // ?pnaUiDebug=1 in the URL enables — see index.html) and the
  // existing-but-previously-unreachable in-game collision debug draw
  // (window.PNA_DEBUG_COLLISION, already wired into the dog/basket/
  // collectible draw() calls; PNA_DEV_MODE is the same flag
  // pup-n-away-assets.js already checks for missing-asset logging).
  // A non-admin never sees this button at all — it stays `hidden`.
  // ---------------------------------------------------------------
  function wireAdminDebugToggle() {
    const btn = document.getElementById('pna-admin-debug-toggle');
    if (!btn) return;
    const isAdmin = !!(integration.profile && integration.profile.is_admin);
    if (!isAdmin) return; // stays hidden — never shown, never wired, for anyone else

    btn.hidden = false;
    // ?pnaUiDebug=1 (see the bottom of index.html) may have already
    // turned on the menu-hitbox class before this ever runs — reflect
    // that starting state rather than fighting it.
    let debugOn = document.body.classList.contains('pna-ui-debug');
    function applyState() {
      document.body.classList.toggle('pna-ui-debug', debugOn);
      window.PNA_DEV_MODE = debugOn;
      window.PNA_DEBUG_COLLISION = debugOn;
      btn.setAttribute('aria-pressed', String(debugOn));
    }
    applyState();
    btn.addEventListener('click', () => {
      debugOn = !debugOn;
      applyState();
      audio.play('buttonClick');
    });
  }

  boot();

  // exposed for manual QA only (e.g. driving frames in an automated
  // preview tool where requestAnimationFrame does not fire) — never
  // used by the normal game loop above.
  window.PNA_DEBUG = {
    get state() { return state; }, STATES, run,
    pump(dtSeconds) { resizeCanvasForDPR(); update(dtSeconds); render(); },
    goTo, ui, audio, menus, levels, integration, startGame, transitionToLevel, wireAdminDebugToggle,
    get dog() { return dog; }, get basket() { return basket; }, get collectibles() { return collectibles; },
    get editor() { return editor; }
  };
})();
