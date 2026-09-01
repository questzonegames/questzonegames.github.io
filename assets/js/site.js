// ===== Quest Zone — shared site behaviour =====
(function () {
  // ---- starfield background ----
  const canvas = document.getElementById('site-starfield');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let stars = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // sparse — a quiet, professional night sky rather than a busy field
      const count = Math.floor((canvas.width * canvas.height) / 9000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.1 + 0.25,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.015 + 0.006,
        blue: Math.random() < 0.3
      }));
    }
    window.addEventListener('resize', resize);
    resize();

    function draw(t) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed * 50 + s.phase);
        ctx.globalAlpha = 0.08 + tw * 0.4;
        ctx.fillStyle = s.blue ? '#7fb3ff' : '#e8ecff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.blue) {
          ctx.globalAlpha *= 0.35;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

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
