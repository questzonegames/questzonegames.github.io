// ===== Pup N Away — UI manager =====
//
// Every gameplay/menu screen is a real DOM overlay (same established
// pattern as Starbound's sb-screen-* elements) sitting on top of the
// canvas — only one is ever visible at a time via showScreen(). Text-
// heavy UI (menus, panels, HUD numbers) is real HTML, not canvas-drawn
// text, for crisp rendering and easy styling at any screen size.
(function () {
  function $(id) { return document.getElementById(id); }

  // M:SS.t — tenths are precise enough to read a level-completion time
  // at a glance without the display feeling twitchy every frame.
  function formatTime(ms) {
    const totalTenths = Math.max(0, Math.floor(ms / 100));
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    return minutes + ':' + String(seconds).padStart(2, '0') + '.' + tenths;
  }

  // ---- Lives display — 3 real supplied PNGs (red/black/gold), never
  // emoji or CSS shapes. The first 3 positions are the normal-life
  // slots (red = active, black = lost, right-to-left); every life
  // above 3 shows as an additional gold heart appended to the right.
  // See updateLivesDisplay() below for the full rendering rule.
  const NORMAL_LIFE_SLOTS = 3;
  const GOLD_HEART_SRC = '../../assets/img/pup-n-away/hud/hearts/gold.png';

  function updateLivesDisplay(livesEl, lives) {
    if (!livesEl) return;
    const safeLives = Math.max(0, lives);
    const activeNormalLives = Math.min(safeLives, NORMAL_LIFE_SLOTS);
    const bonusLives = Math.max(safeLives - NORMAL_LIFE_SLOTS, 0);

    // Normal slots 1-3: both the red and black PNG are always present
    // (preloaded from first paint) — just toggle which one is .active.
    for (let slot = 1; slot <= NORMAL_LIFE_SLOTS; slot++) {
      const slotEl = livesEl.querySelector('[data-life-slot="' + slot + '"]');
      if (!slotEl) continue;
      const isActive = slot <= activeNormalLives;
      const redImg = slotEl.querySelector('[data-heart-color="red"]');
      const blackImg = slotEl.querySelector('[data-heart-color="black"]');
      if (redImg) redImg.classList.toggle('active', isActive);
      if (blackImg) blackImg.classList.toggle('active', !isActive);
    }

    // Bonus gold hearts (life 4+) — added/removed to exactly match
    // bonusLives, keyed by a stable data-bonus-index so an already-
    // shown gold heart is never torn down and rebuilt (which would
    // restart its fade-in for no reason) when the count changes.
    livesEl.querySelectorAll('.pna-heart-gold-slot').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-bonus-index'), 10);
      if (idx > bonusLives) el.remove();
    });
    for (let i = 1; i <= bonusLives; i++) {
      if (livesEl.querySelector('.pna-heart-gold-slot[data-bonus-index="' + i + '"]')) continue;
      const img = document.createElement('img');
      img.className = 'pna-heart-icon pna-heart-gold-slot';
      img.setAttribute('data-bonus-index', String(i));
      img.alt = '';
      img.src = GOLD_HEART_SRC;
      livesEl.appendChild(img);
      // Force a style flush before adding .active, a beat later, so
      // the opacity/scale transition actually plays instead of
      // starting already at its end state (the browser would otherwise
      // coalesce "append + immediately add .active" into one paint).
      void img.offsetWidth;
      setTimeout(() => img.classList.add('active'), 20);
    }

    // Once bonus hearts push the row past 3, shrink every heart
    // slightly (see the --pna-heart-extra-driven clamp() in the CSS)
    // so the row can never overflow or wrap out of the Lives box.
    livesEl.style.setProperty('--pna-heart-extra', String(bonusLives));
  }

  function createUIManager() {
    const screens = {
      LOADING: $('pna-screen-loading'),
      TITLE: $('pna-screen-title'),
      INTRO: $('pna-screen-intro'),
      COUNTDOWN: $('pna-screen-countdown'),
      LEVEL_COMPLETE: $('pna-screen-level-complete'),
      GAME_OVER: $('pna-screen-game-over'),
      PAUSED: $('pna-screen-paused')
    };
    const hud = $('pna-hud');
    const missBanner = $('pna-miss-banner');

    function showScreen(key) {
      Object.values(screens).forEach((el) => { if (el) el.classList.add('hidden'); });
      if (key && screens[key]) screens[key].classList.remove('hidden');
    }

    function setHudVisible(visible) {
      if (hud) hud.classList.toggle('hidden', !visible);
    }

    function updateHud({ score, bonesCollected, bonesTotal, lives, levelName }) {
      const scoreEl = $('pna-hud-score');
      const bonesEl = $('pna-hud-bones');
      const levelEl = $('pna-hud-level');
      if (scoreEl) scoreEl.textContent = String(score);
      if (bonesEl) bonesEl.textContent = bonesCollected + ' / ' + bonesTotal;
      if (levelEl) levelEl.textContent = levelName;
      updateLivesDisplay($('pna-hud-lives'), lives);
    }

    function flashMissBanner() {
      if (!missBanner) return;
      missBanner.classList.remove('hidden');
      missBanner.classList.add('show');
      setTimeout(() => { missBanner.classList.remove('show'); missBanner.classList.add('hidden'); }, 900);
    }

    function setLoadingProgress(done, total) {
      const bar = $('pna-loading-bar');
      const label = $('pna-loading-label');
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      if (bar) bar.style.width = pct + '%';
      if (label) label.textContent = 'Loading… ' + pct + '%';
    }

    function setCountdownText(text) {
      const el = $('pna-countdown-number');
      if (el) el.textContent = text;
    }

    function setTimerText(ms) {
      const el = $('pna-hud-timer');
      if (el) el.textContent = formatTime(ms);
    }

    // The artwork itself already says "LEVEL COMPLETE!" (and, on the
    // Continue button, "CONTINUE") — this only ever fills in the real
    // per-run values, never duplicates baked-in label text. Also
    // re-enables the panel's two buttons, since bindButtonOnce()
    // disables a button the instant it's clicked (see below) and this
    // is the one place a freshly (re)shown panel gets a clean slate.
    function setLevelCompletePanel({ levelName, score, bonesCollected, bonesTotal, timeMs }) {
      const nameEl = $('pna-lc-level-name');
      const scoreEl = $('pna-lc-score');
      const bonesEl = $('pna-lc-bones');
      const timeEl = $('pna-lc-time');
      if (nameEl) nameEl.textContent = levelName;
      if (scoreEl) scoreEl.textContent = String(score);
      if (bonesEl) bonesEl.textContent = bonesCollected + ' / ' + bonesTotal;
      if (timeEl) timeEl.textContent = formatTime(timeMs);
      [$('pna-btn-continue'), $('pna-btn-return-lc')].forEach((btn) => { if (btn) btn.disabled = false; });
    }

    function setGameOverPanel({ score }) {
      const scoreEl = $('pna-go-score');
      if (scoreEl) scoreEl.textContent = String(score);
      [$('pna-btn-restart-act'), $('pna-btn-return-go')].forEach((btn) => { if (btn) btn.disabled = false; });
    }

    function bindButton(id, handler) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', handler);
    }

    // Like bindButton(), but disables the element the instant it's
    // clicked — used for the result-panel buttons (Continue/Restart
    // Act/Return to Lobby) so a rapid double-tap can never fire the
    // navigation/progression-saving handler twice. setLevelCompletePanel()/
    // setGameOverPanel() re-enable these each time that panel is freshly
    // populated, so a later replay isn't left permanently disabled.
    function bindButtonOnce(id, handler) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', (e) => {
        if (el.disabled) return;
        el.disabled = true;
        handler(e);
      });
    }

    return {
      showScreen, setHudVisible, updateHud, flashMissBanner, setLoadingProgress,
      setCountdownText, setTimerText, setLevelCompletePanel, setGameOverPanel, bindButton, bindButtonOnce
    };
  }

  window.PNA_UI = { createUIManager };
})();
