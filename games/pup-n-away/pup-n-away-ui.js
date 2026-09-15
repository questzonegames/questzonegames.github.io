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
      const livesEl = $('pna-hud-lives');
      const levelEl = $('pna-hud-level');
      if (scoreEl) scoreEl.textContent = String(score);
      if (bonesEl) bonesEl.textContent = bonesCollected + ' / ' + bonesTotal;
      // A plain text heart glyph (not the ❤️ emoji) so the CSS color
      // below is what actually renders it red on every platform/font,
      // instead of leaving it to whatever color an emoji font ships.
      if (livesEl) livesEl.textContent = '♥'.repeat(Math.max(0, lives));
      if (levelEl) levelEl.textContent = levelName;
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

    function setLevelCompletePanel({ levelName, score, bonesCollected, bonesTotal, isFinalLevel, timeMs }) {
      const nameEl = $('pna-lc-level-name');
      const scoreEl = $('pna-lc-score');
      const bonesEl = $('pna-lc-bones');
      const timeEl = $('pna-lc-time');
      const continueBtn = $('pna-btn-continue');
      if (nameEl) nameEl.textContent = levelName + ' Complete!';
      if (scoreEl) scoreEl.textContent = String(score);
      if (bonesEl) bonesEl.textContent = bonesCollected + ' / ' + bonesTotal;
      if (timeEl) timeEl.textContent = formatTime(timeMs);
      if (continueBtn) continueBtn.textContent = isFinalLevel ? 'Finish' : 'Continue';
    }

    function setGameOverPanel({ score }) {
      const scoreEl = $('pna-go-score');
      if (scoreEl) scoreEl.textContent = String(score);
    }

    function bindButton(id, handler) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', handler);
    }

    function setMuteButtonState(muted) {
      const btn = $('pna-btn-mute');
      if (btn) btn.textContent = muted ? '🔇' : '🔊';
    }

    return {
      showScreen, setHudVisible, updateHud, flashMissBanner, setLoadingProgress,
      setCountdownText, setTimerText, setLevelCompletePanel, setGameOverPanel, bindButton,
      setMuteButtonState
    };
  }

  window.PNA_UI = { createUIManager };
})();
