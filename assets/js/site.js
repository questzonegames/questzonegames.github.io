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

  // ---- chrome button lens flare (Profile / Signup / Login) ----
  // A small sparkle on the frame that drifts opposite the cursor —
  // giving the illusion of a reflective surface reacting to viewpoint.
  // CSS handles the actual easing (.flare has a transition), this just
  // sets the target transform on mousemove.
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.btn-chrome-dark, .btn-chrome-blue').forEach((btn) => {
    const sweep = document.createElement('span');
    sweep.className = 'chrome-sweep';
    const flare = document.createElement('span');
    flare.className = 'flare';
    btn.appendChild(sweep);
    btn.appendChild(flare);

    if (reduceMotion) return; // keep the flare static, skip the tracking

    const maxDrift = 9; // px — stays near the corner, never wanders into the center
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * 2 - 1;   // -1..1
      const py = ((e.clientY - r.top) / r.height) * 2 - 1;   // -1..1
      const dx = -px * maxDrift; // inverse — cursor right, flare drifts left
      const dy = -py * maxDrift; // cursor down, flare drifts up
      flare.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    btn.addEventListener('mouseleave', () => {
      flare.style.transform = 'translate(-50%, -50%)';
    });
  });

  // ---- homepage game-selection grids (Total Level Games / Arcade Games) ----
  // Data-driven placeholders — later: real title/image/route/status per
  // slot, no markup duplication needed to add more.
  const gamepadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5"/><line x1="7" y1="10.5" x2="7" y2="14.5"/><line x1="5" y1="12.5" x2="9" y2="12.5"/><circle cx="16" cy="10.5" r="1"/><circle cx="18.5" cy="13" r="1"/></svg>';

  function makeGameCard(opts) {
    const a = document.createElement('a');
    a.className = 'game-card' + (opts.image ? ' has-thumb' : '');
    a.href = opts.route || '#';
    a.setAttribute('aria-label', opts.title);

    if (opts.image) {
      // real, live game — full-bleed artwork + metallic title overlay,
      // no placeholder icon/label/number.
      a.innerHTML =
        '<span class="corner-brackets sm"><i></i><i></i><i></i><i></i></span>' +
        '<img class="card-thumb" src="' + opts.image + '" alt="" loading="lazy">' +
        '<span class="card-thumb-fade"></span>' +
        '<span class="card-title">' + opts.title + '</span>';
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

    // Slot 01 is a real, live game — swap the placeholder for Space
    // Snake (existing route, no duplicate page). Slots 02-24 stay
    // untouched placeholders.
    TOTAL_LEVEL_GAMES[0] = {
      id: 'space-snake',
      number: '01',
      title: 'Space Snake',
      image: 'assets/img/space-snake-thumb.png',
      route: 'games/space-snake/',
      status: 'active',
      category: 'total-level'
    };
    TOTAL_LEVEL_GAMES[1] = {
      id: 'anagram-quest',
      number: '02',
      title: 'Anagram Quest',
      image: 'assets/img/anagram-quest-thumb.svg',
      route: 'games/anagram-quest/',
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

  // ---- game-card interaction: same tilt / cursor-light / shimmer /
  // flare system as the Profile dashboard tiles, so it's genuinely one
  // shared component family. ----
  document.querySelectorAll('.game-card').forEach((card) => {
    const light = document.createElement('span');
    light.className = 'tile-light';
    const sweep = document.createElement('span');
    sweep.className = 'tile-shimmer';
    const flare = document.createElement('span');
    flare.className = 'flare';
    card.appendChild(light);
    card.appendChild(sweep);
    card.appendChild(flare);

    if (reduceMotion) return;

    const maxTilt = 3, maxDrift = 6;
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rotY = (px - 0.5) * maxTilt * 2;
      const rotX = (0.5 - py) * maxTilt * 2;
      card.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.02)`;
      card.style.setProperty('--mx', (px * 100) + '%');
      card.style.setProperty('--my', (py * 100) + '%');
      const dx = -(px * 2 - 1) * maxDrift;
      const dy = -(py * 2 - 1) * maxDrift;
      flare.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale(1)';
      flare.style.transform = 'translate(-50%, -50%)';
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
