// ===== Quest Zone — reusable Achievement Inspection system =====
//
// Any page that links assets/css/site.css and this script can pop an
// achievement icon out into a cinematic inspection card:
//
//   window.QZAchievementInspection.open(achievement, sourceEl);
//
// achievement shape (only icon/name/tier/description are used today —
// progress/unlocked/game/category are accepted and ignored so this can
// grow into a richer inspection view later without a breaking change):
//   {
//     id, name, tier, description, icon,
//     progress, unlocked, game, category
//   }
//
// sourceEl is the element the icon visually flew out of — its
// getBoundingClientRect() is the animation's start point, and close()
// re-measures it live so the icon flies back to wherever it actually is
// (works even if the page scrolled/resized while the card was open).
(function () {
  let backdropEl, cardEl, flyerEl, flyerImg, closeBtn;
  let cardIconImg, nameEl, tierEl, descEl;
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
      '<div class="ach-flyer"><img alt=""></div>' +
      '<div class="ach-card" role="dialog" aria-modal="true" aria-labelledby="ach-card-title" tabindex="-1">' +
        '<span class="corner-brackets"><i></i><i></i><i></i><i></i></span>' +
        '<span class="hud-edge-glow"></span>' +
        '<button type="button" class="ach-close" aria-label="Close achievement details">✕</button>' +
        '<div class="ach-card-icon"><img alt=""></div>' +
        '<h2 class="ach-card-name" id="ach-card-title"></h2>' +
        '<div class="ach-card-tier"></div>' +
        '<p class="ach-card-desc"></p>' +
      '</div>';
    document.body.appendChild(backdropEl);

    flyerEl = backdropEl.querySelector('.ach-flyer');
    flyerImg = flyerEl.querySelector('img');
    cardEl = backdropEl.querySelector('.ach-card');
    closeBtn = backdropEl.querySelector('.ach-close');
    cardIconImg = cardEl.querySelector('.ach-card-icon img');
    nameEl = cardEl.querySelector('.ach-card-name');
    tierEl = cardEl.querySelector('.ach-card-tier');
    descEl = cardEl.querySelector('.ach-card-desc');

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

  function open(achievement, sourceEl) {
    build();
    if (isOpen || !achievement) return;
    isOpen = true;
    currentSource = sourceEl || null;
    lastFocused = document.activeElement;

    cardIconImg.src = achievement.icon;
    cardIconImg.alt = achievement.name + ' (' + achievement.tier + ')';
    nameEl.textContent = achievement.name;
    tierEl.textContent = achievement.tier;
    tierEl.className = 'ach-card-tier tier-' + String(achievement.tier || '').toLowerCase();
    descEl.textContent = achievement.description || '';

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
    flyerImg.src = achievement.icon;
    flyerEl.style.display = 'block';
    flyerEl.style.left = sourceRect.left + 'px';
    flyerEl.style.top = sourceRect.top + 'px';
    flyerEl.style.width = sourceRect.width + 'px';
    flyerEl.style.height = sourceRect.height + 'px';
    flyerEl.style.transform = 'none';
    flyerEl.style.opacity = '1';

    // wait a frame so the (still-transparent) card is laid out and its
    // icon slot can be measured as the real flight target
    requestAnimationFrame(() => {
      const targetRect = cardEl.querySelector('.ach-card-icon').getBoundingClientRect();
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
    // scrolled or resized while the card was open
    const sourceRect = sourceEl.getBoundingClientRect();
    const cardIconRect = cardEl.querySelector('.ach-card-icon').getBoundingClientRect();
    const scale = Math.min(cardIconRect.width / sourceRect.width, cardIconRect.height / sourceRect.height) || 1;
    const tx = (cardIconRect.left + cardIconRect.width / 2) - (sourceRect.left + sourceRect.width / 2);
    const ty = (cardIconRect.top + cardIconRect.height / 2) - (sourceRect.top + sourceRect.height / 2);
    const midScale = 1 + (scale - 1) * 0.55;

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
