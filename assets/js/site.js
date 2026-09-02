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
  document.querySelectorAll('[data-coming-soon]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      window.qzToast(el.getAttribute('data-coming-soon') || 'Coming soon!');
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
