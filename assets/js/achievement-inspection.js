// ===== Quest Zone — reusable Achievement Inspection system =====
//
// Any page that links assets/css/site.css and this script can pop an
// achievement out into a cinematic inspection card:
//
//   window.QZAchievementInspection.open(achievement, sourceEl);
//
// achievement shape (only icon/name/tier/description are required —
// progress/unlocked/unlockedAt/game/category/onPin/onUnpin are accepted
// and skipped gracefully when absent, so a caller passing the minimal
// set still works):
//   {
//     id, name, tier, description, icon,
//     unlocked, unlockedAt, progress, game, category, onPin, onUnpin
//   }
//
// sourceEl is the element the tile visually flew out of — its
// getBoundingClientRect() is the animation's start point, and close()
// re-measures it live so the tile flies back to wherever it actually is
// (works even if the page scrolled/resized while the card was open).
//
// The popped-out card is a BIGGER rendering of the exact same tier
// panel artwork the achievements grid uses (assets/img/achievements/
// panel-<locked|tier>.png) — not a separate CSS-drawn dialog — picked
// with the same Locked-first-tier-second rule as the grid (see
// panelUrlFor below). The flying animation is a live clone of the
// actual source tile (see setFlyerContent), so it shows the real panel
// art and content in flight, never a placeholder/broken image.
(function () {
  // Mirrors PANEL_IMAGES in profile/achievements.html's cardVars() —
  // kept here too (rather than imported) because this module has no
  // dependency on that page's own script, only on assets/css/site.css
  // and assets/js/qz-achievements.js being present. Both of this
  // module's current callers (profile/achievements.html,
  // profile/index.html) live at the same path depth, so the relative
  // paths below resolve correctly from either.
  const PANEL_IMAGES = {
    locked: '../assets/img/achievements/panel-locked.png',
    bronze: '../assets/img/achievements/panel-bronze.png',
    silver: '../assets/img/achievements/panel-silver.png',
    gold: '../assets/img/achievements/panel-gold.png',
    platinum: '../assets/img/achievements/panel-platinum.png',
    diamond: '../assets/img/achievements/panel-diamond.png',
    mythic: '../assets/img/achievements/panel-mythic.png'
  };
  function panelUrlFor(tierKey, unlocked) {
    const key = unlocked ? String(tierKey || '').toLowerCase() : 'locked';
    return PANEL_IMAGES[key] || PANEL_IMAGES.locked;
  }

  let backdropEl, cardEl, flyerEl, closeBtn;
  let cardIconBadge, nameEl, tierEl, descEl, statusEl, requirementEl, progressWrap, progressLabel, progressInner, pinActionsEl;
  let currentSource = null;
  let isOpen = false;
  let lastFocused = null;

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function build() {
    if (backdropEl) return;

    backdropEl = document.createElement('div');
    backdropEl.className = 'ach-backdrop';
    backdropEl.setAttribute('aria-hidden', 'true');
    backdropEl.innerHTML =
      '<div class="ach-flyer"></div>' +
      '<div class="ach-card" role="dialog" aria-modal="true" aria-labelledby="ach-card-title" tabindex="-1">' +
        '<button type="button" class="ach-close" aria-label="Close achievement details">✕</button>' +
        '<div class="ach-card-top">' +
          '<span class="ach-card-icon-badge"></span>' +
          '<div style="min-width:0;">' +
            '<h2 class="ach-card-name" id="ach-card-title"></h2>' +
            '<div class="ach-card-tier"></div>' +
          '</div>' +
        '</div>' +
        '<p class="ach-card-desc"></p>' +
        '<div class="ach-card-status-line"></div>' +
        '<div class="ach-card-requirement"></div>' +
        '<div class="ach-card-progress-wrap" hidden>' +
          '<div class="ach-card-progress-label"></div>' +
          '<div class="ach-card-progress-outer"><div class="ach-card-progress-inner" style="width:0%"></div></div>' +
        '</div>' +
        '<div class="ach-card-pin-actions"></div>' +
      '</div>';
    document.body.appendChild(backdropEl);

    flyerEl = backdropEl.querySelector('.ach-flyer');
    cardEl = backdropEl.querySelector('.ach-card');
    closeBtn = backdropEl.querySelector('.ach-close');
    cardIconBadge = cardEl.querySelector('.ach-card-icon-badge');
    nameEl = cardEl.querySelector('.ach-card-name');
    tierEl = cardEl.querySelector('.ach-card-tier');
    descEl = cardEl.querySelector('.ach-card-desc');
    statusEl = cardEl.querySelector('.ach-card-status-line');
    requirementEl = cardEl.querySelector('.ach-card-requirement');
    progressWrap = cardEl.querySelector('.ach-card-progress-wrap');
    progressLabel = cardEl.querySelector('.ach-card-progress-label');
    progressInner = cardEl.querySelector('.ach-card-progress-inner');
    pinActionsEl = cardEl.querySelector('.ach-card-pin-actions');

    // click the dark backdrop (not the card) to close
    backdropEl.addEventListener('click', (e) => {
      if (e.target === backdropEl) close();
    });
    // never let a click inside the card bubble out to the backdrop
    cardEl.addEventListener('click', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (isOpen && e.key === 'Escape') close();
    });

    if ('inert' in backdropEl) backdropEl.inert = true;
  }

  function dimSiblings(sourceEl, on) {
    if (!sourceEl) return;
    const group = sourceEl.closest('.pinned-badges');
    if (!group) return;
    group.querySelectorAll('.pin-slot').forEach((el) => {
      if (el !== sourceEl) el.classList.toggle('pin-dimmed', on);
    });
  }

  // Clones the actual source tile into the flyer so what's flying is a
  // pixel-real copy of the tile itself (real panel art, real icon/name)
  // rather than a synthetic placeholder — nothing to glitch or show
  // see-through, since there's no separate <img> with its own src to
  // fail loading.
  function setFlyerContent(sourceEl) {
    flyerEl.innerHTML = '';
    if (!sourceEl) return;
    const clone = sourceEl.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.position = 'static';
    clone.style.transform = 'none';
    clone.style.transition = 'none';
    clone.style.pointerEvents = 'none';
    clone.style.cursor = 'default';
    clone.style.visibility = 'visible'; // sourceEl itself is hidden while flying (see open()/close()) — the clone must not inherit that via cloneNode
    clone.tabIndex = -1;
    flyerEl.appendChild(clone);
  }

  function open(achievement, sourceEl) {
    build();
    if (isOpen || !achievement) return;
    isOpen = true;
    currentSource = sourceEl || null;
    lastFocused = document.activeElement;

    const unlocked = achievement.unlocked !== false; // callers that omit it (e.g. pinned badges, always unlocked) default true
    // Set directly as background-image (not a --panel-img custom property
    // read via var() in site.css) — a relative url() inside a custom
    // property resolves against the STYLESHEET that consumes it, which
    // for this external site.css would be assets/css/, not the page,
    // silently breaking the path (assets/css/../assets/img/... ==
    // assets/assets/img/...). Setting the property directly on the
    // element's inline style resolves the url() against the page itself,
    // matching where these ../assets/img/... paths actually point.
    cardEl.style.backgroundImage = "url('" + panelUrlFor(achievement.tier, unlocked) + "')";
    cardEl.classList.toggle('locked', !unlocked);

    cardIconBadge.textContent = achievement.icon || '🏆';
    nameEl.textContent = achievement.name;
    tierEl.textContent = achievement.tier;
    tierEl.className = 'ach-card-tier tier-' + String(achievement.tier || '').toLowerCase();
    descEl.textContent = achievement.description || '';

    // ---- optional richer fields — skipped/hidden gracefully when
    // absent, exactly as this file's header comment always promised. ----
    if (statusEl) {
      if (unlocked) {
        let when = '';
        if (achievement.unlockedAt) {
          const d = new Date(achievement.unlockedAt);
          if (!isNaN(d)) {
            when = ' — ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
              ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          }
        }
        statusEl.textContent = 'Unlocked' + when;
        statusEl.className = 'ach-card-status-line unlocked-line';
        statusEl.hidden = false;
      } else {
        statusEl.textContent = 'Locked';
        statusEl.className = 'ach-card-status-line';
        statusEl.hidden = false;
      }
    }
    if (requirementEl) {
      if (achievement.requirement) { requirementEl.textContent = achievement.requirement; requirementEl.hidden = false; }
      else { requirementEl.hidden = true; }
    }
    if (progressWrap) {
      const p = achievement.progress;
      if (p && p.max > 0) {
        progressWrap.hidden = false;
        progressLabel.textContent = 'Progress: ' + p.current.toLocaleString() + ' / ' + p.max.toLocaleString();
        progressInner.style.width = Math.min(100, (100 * p.current / p.max)).toFixed(1) + '%';
      } else {
        progressWrap.hidden = true;
      }
    }
    if (pinActionsEl) {
      pinActionsEl.innerHTML = '';
      if (typeof achievement.onPin === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = 'Pin Achievement';
        btn.addEventListener('click', () => { achievement.onPin(); close(); });
        pinActionsEl.appendChild(btn);
      } else if (typeof achievement.onUnpin === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'unpin'; btn.textContent = 'Unpin Achievement';
        btn.addEventListener('click', () => { achievement.onUnpin(); close(); });
        pinActionsEl.appendChild(btn);
      }
    }

    document.documentElement.classList.add('ach-scroll-lock');
    backdropEl.setAttribute('aria-hidden', 'false');
    if ('inert' in backdropEl) backdropEl.inert = false;
    backdropEl.classList.add('show');
    dimSiblings(sourceEl, true);

    const skipFlight = reduceMotion() || !sourceEl || typeof sourceEl.getBoundingClientRect !== 'function';

    if (skipFlight) {
      flyerEl.style.display = 'none';
      cardEl.classList.add('show');
      closeBtn.focus();
      return;
    }

    if (sourceEl) sourceEl.style.visibility = 'hidden';

    const sourceRect = sourceEl.getBoundingClientRect();
    setFlyerContent(sourceEl);
    flyerEl.style.display = 'block';
    flyerEl.style.left = sourceRect.left + 'px';
    flyerEl.style.top = sourceRect.top + 'px';
    flyerEl.style.width = sourceRect.width + 'px';
    flyerEl.style.height = sourceRect.height + 'px';
    flyerEl.style.transform = 'none';
    flyerEl.style.opacity = '1';

    // wait a frame so the (still-transparent) card is laid out and its
    // final on-screen box can be measured as the real flight target
    requestAnimationFrame(() => {
      const targetRect = cardEl.getBoundingClientRect();
      const scale = Math.min(targetRect.width / sourceRect.width, targetRect.height / sourceRect.height) || 1;
      const tx = (targetRect.left + targetRect.width / 2) - (sourceRect.left + sourceRect.width / 2);
      const ty = (targetRect.top + targetRect.height / 2) - (sourceRect.top + sourceRect.height / 2);
      const midScale = 1 + (scale - 1) * 0.6;

      const anim = flyerEl.animate([
        { transform: 'perspective(900px) translate(0px,0px) rotateX(0deg) rotateY(0deg) scale(1)', offset: 0 },
        { transform: `perspective(900px) translate(${tx * 0.55}px, ${ty * 0.55 - 26}px) rotateX(6deg) rotateY(180deg) scale(${midScale})`, offset: 0.6 },
        { transform: `perspective(900px) translate(${tx}px, ${ty}px) rotateX(0deg) rotateY(360deg) scale(${scale})`, offset: 1 }
      ], { duration: 650, easing: 'cubic-bezier(0.34, 1.4, 0.44, 1)', fill: 'forwards' });

      anim.onfinish = () => {
        flyerEl.style.opacity = '0';
        cardEl.classList.add('show');
        closeBtn.focus();
      };
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;

    const sourceEl = currentSource;
    cardEl.classList.remove('show');
    dimSiblings(sourceEl, false);

    function finish() {
      document.documentElement.classList.remove('ach-scroll-lock');
      backdropEl.classList.remove('show');
      backdropEl.setAttribute('aria-hidden', 'true');
      if ('inert' in backdropEl) backdropEl.inert = true;
      if (sourceEl) sourceEl.style.visibility = '';
      flyerEl.style.display = 'none';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
      currentSource = null;
    }

    const skipFlight = reduceMotion() || !sourceEl || flyerEl.style.display === 'none';
    if (skipFlight) {
      finish();
      return;
    }

    // re-measure the source's LIVE position — correct even if the page
    // scrolled or resized while the card was open — and re-clone it so
    // the flight-back shows the tile's current state (e.g. a pin toggle
    // made from the card).
    const sourceRect = sourceEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const scale = Math.min(cardRect.width / sourceRect.width, cardRect.height / sourceRect.height) || 1;
    const tx = (cardRect.left + cardRect.width / 2) - (sourceRect.left + sourceRect.width / 2);
    const ty = (cardRect.top + cardRect.height / 2) - (sourceRect.top + sourceRect.height / 2);
    const midScale = 1 + (scale - 1) * 0.55;

    setFlyerContent(sourceEl);
    flyerEl.style.left = sourceRect.left + 'px';
    flyerEl.style.top = sourceRect.top + 'px';
    flyerEl.style.width = sourceRect.width + 'px';
    flyerEl.style.height = sourceRect.height + 'px';
    flyerEl.style.display = 'block';
    flyerEl.style.opacity = '1';

    const anim = flyerEl.animate([
      { transform: `perspective(900px) translate(${tx}px, ${ty}px) rotateX(0deg) rotateY(360deg) scale(${scale})`, offset: 0 },
      { transform: `perspective(900px) translate(${tx * 0.45}px, ${ty * 0.45 - 18}px) rotateX(6deg) rotateY(180deg) scale(${midScale})`, offset: 0.45 },
      { transform: 'perspective(900px) translate(0px,0px) rotateX(0deg) rotateY(0deg) scale(1)', offset: 1 }
    ], { duration: 520, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' });

    anim.onfinish = () => {
      flyerEl.style.opacity = '0';
      finish();
    };
  }

  window.QZAchievementInspection = { open, close };
})();
