// ===== Quest Zone — shared site behaviour =====
(function () {
  // ---- toast helper ----
  let toastEl = document.getElementById('qz-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'qz-toast';
    document.body.appendChild(toastEl);
  }
  let toastTimer;
  window.qzToast = function (msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };

  // ---- signup / login placeholders ----
  // qz-header-auth.js repoints Signup/Login from this placeholder to the
  // real signup.html/login.html once accounts are live, by removing the
  // data-coming-soon attribute and setting a real href — but it does that
  // asynchronously (it awaits getSession() first), so it can still be
  // mid-flight when this runs and binds these listeners. Re-reading the
  // attribute INSIDE the handler (not just at bind time) means a listener
  // bound before the repoint still does the right thing afterwards: once
  // the attribute's gone, this becomes a no-op and the real href navigates
  // normally instead of the click being silently eaten by preventDefault.
  document.querySelectorAll('[data-coming-soon]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const msg = el.getAttribute('data-coming-soon');
      if (!msg) return;
      e.preventDefault();
      window.qzToast(msg);
    });
  });

  // ---- chrome button shimmer sweep (Profile / Admin Zone / Signup / Login) ----
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.btn-chrome-dark, .btn-chrome-blue').forEach((btn) => {
    const sweep = document.createElement('span');
    sweep.className = 'chrome-sweep';
    btn.appendChild(sweep);
  });

  // ---- homepage game-selection grids (Total Level Games / Arcade Games) ----
  // Data-driven placeholders — later: real title/image/route/status per
  // slot, no markup duplication needed to add more.
  const gamepadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5"/><line x1="7" y1="10.5" x2="7" y2="14.5"/><line x1="5" y1="12.5" x2="9" y2="12.5"/><circle cx="16" cy="10.5" r="1"/><circle cx="18.5" cy="13" r="1"/></svg>';

  function makeGameCard(opts) {
    const a = document.createElement('a');
    a.className = 'game-card' + (opts.image ? ' has-thumb' : '') + (opts.thumbContain ? ' thumb-contain' : '');
    a.href = opts.route || '#';
    a.setAttribute('aria-label', opts.title);

    if (opts.image) {
      // real, live game — full-bleed artwork + metallic title overlay,
      // no placeholder icon/label/number. opts.thumbContain (Anagram
      // Quest's own logo, which already carries its name as artwork) is
      // shown whole/centered instead of full-bleed-cropped, and skips the
      // redundant plain-text title underneath it — see .thumb-contain in
      // site.css.
      a.innerHTML =
        '<span class="corner-brackets sm"><i></i><i></i><i></i><i></i></span>' +
        '<img class="card-thumb" src="' + opts.image + '" alt="' + (opts.thumbContain ? opts.title : '') + '" loading="lazy">' +
        (opts.thumbContain ? '' :
          '<span class="card-thumb-fade"></span>' +
          '<span class="card-title">' + opts.title + '</span>'
        );
    } else {
      a.innerHTML =
        '<span class="corner-brackets sm"><i></i><i></i><i></i><i></i></span>' +
        '<span class="icon" aria-hidden="true">' + gamepadIcon + '</span>' +
        (opts.label ? '<span class="label">' + opts.label + '</span>' : '') +
        (opts.number ? '<span class="number">' + opts.number + '</span>' : '');
    }

    if (opts.active) {
      // real route — let the <a href> navigate normally (supports
      // ctrl/cmd-click, middle-click, etc. like any other game link)
    } else {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.qzToast(opts.comingSoon);
      });
    }
    return a;
  }

  const totalLevelGrid = document.getElementById('total-level-grid');
  if (totalLevelGrid) {
    const TOTAL_LEVEL_GAMES = Array.from({ length: 24 }, (_, i) => ({
      id: 'total-level-' + (i + 1),
      number: String(i + 1).padStart(2, '0'),
      title: 'Total Level Game ' + String(i + 1).padStart(2, '0'),
      image: null,
      route: '#',
      status: 'coming-soon',
      category: 'total-level'
    }));

    // Slots 01-02 are real, live games — only their homepage placement is
    // swapped here (Anagram Quest first, Space Snake second); the games
    // themselves, their routes, and their own pages are untouched. Slots
    // 03-24 stay untouched placeholders.
    TOTAL_LEVEL_GAMES[0] = {
      id: 'anagram-quest',
      number: '01',
      title: 'Anagram Quest',
      // the real Anagram Quest logo (assets/img/anagram-quest/logo.png,
      // same exact asset used throughout the game itself) shown whole
      // and centered — see thumbContain below — rather than the old
      // placeholder "AQ letter tile" scene cropped full-bleed.
      image: 'assets/img/anagram-quest/logo.png',
      thumbContain: true,
      route: 'games/anagram-quest/',
      status: 'active',
      category: 'total-level'
    };
    TOTAL_LEVEL_GAMES[1] = {
      id: 'space-snake',
      number: '02',
      title: 'Space Snake',
      image: 'assets/img/space-snake-thumb.png',
      route: 'games/space-snake/',
      status: 'active',
      category: 'total-level'
    };

    TOTAL_LEVEL_GAMES.forEach((g) => {
      totalLevelGrid.appendChild(makeGameCard({
        title: g.title,
        route: g.route,
        // a real, active game with no thumbnail yet (Anagram Quest, until
        // real art exists) still shows its own name instead of the
        // generic placeholder label, same as Space Snake's image-based
        // card already does via its title-over-artwork overlay
        label: (g.status === 'active' && !g.image) ? g.title : 'Total Level<br>Game',
        number: g.number,
        image: g.image,
        thumbContain: g.thumbContain,
        active: g.status === 'active',
        comingSoon: 'This Total Level Game slot is coming soon!'
      }));
    });
  }

  const arcadeGrid = document.getElementById('arcade-grid');
  if (arcadeGrid) {
    const ARCADE_GAMES = Array.from({ length: 18 }, (_, i) => ({
      id: 'arcade-' + (i + 1),
      title: 'Arcade Game ' + (i + 1),
      image: null,
      route: '#',
      status: 'coming-soon',
      category: 'arcade'
    }));
    ARCADE_GAMES.forEach((g) => {
      arcadeGrid.appendChild(makeGameCard({
        title: g.title,
        route: g.route,
        comingSoon: 'More Arcade Games are coming soon!'
      }));
    });
  }

  // ---- game-card interaction: tilt / cursor-light / shimmer, same
  // shared component family as the Profile dashboard tiles. ----
  document.querySelectorAll('.game-card').forEach((card) => {
    const light = document.createElement('span');
    light.className = 'tile-light';
    const sweep = document.createElement('span');
    sweep.className = 'tile-shimmer';
    card.appendChild(light);
    card.appendChild(sweep);

    if (reduceMotion) return;

    const maxTilt = 3;
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rotY = (px - 0.5) * maxTilt * 2;
      const rotX = (0.5 - py) * maxTilt * 2;
      card.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.02)`;
      card.style.setProperty('--mx', (px * 100) + '%');
      card.style.setProperty('--my', (py * 100) + '%');
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale(1)';
    });
  });

  // ---- header search ----
  const searchForm = document.getElementById('site-search-form');
  const searchNote = document.getElementById('search-note');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (document.getElementById('site-search-input').value || '').trim().toLowerCase();
      if (!q) return;
      if ('space snake'.includes(q) || 'snake'.includes(q) || q.includes('snake')) {
        window.location.href = 'games/space-snake/';
        return;
      }
      if (searchNote) {
        searchNote.textContent = 'No games found for "' + document.getElementById('site-search-input').value + '" — more titles are coming soon!';
        searchNote.classList.add('show');
        searchNote.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
})();
