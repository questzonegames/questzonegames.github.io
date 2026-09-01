// ===== Quest Zone — homepage-only starfield background =====
// Pitch black canvas, behind everything (z-index -1) so it never covers
// the header/nav panels — it only ever shows through the open black
// space around them. A dense scatter of crisp white/blue stars, each
// twinkling faintly on its own. This file is included on the homepage only.
(function () {
  const canvas = document.getElementById('site-starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let stars = [];

  function resize() {
    canvas.width = Math.max(1, window.innerWidth || 1);
    canvas.height = Math.max(1, window.innerHeight || 1);

    // dense, high-quality scatter — a proper starfield, not a sprinkle
    const count = Math.floor((canvas.width * canvas.height) / 900);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.6 + 0.6,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.015 + 0.006,
      blue: Math.random() < 0.38
    }));
  }
  window.addEventListener('resize', resize);
  resize();

  function draw(t) {
    try {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const s of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed * 50 + s.phase);
        const alpha = 0.45 + twinkle * 0.5;
        const color = s.blue ? '#a8d0ff' : '#ffffff';

        ctx.fillStyle = color;
        ctx.globalAlpha = Math.min(1, alpha * 0.3);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = Math.min(1, alpha);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } catch (err) {
      // never let one bad frame kill the loop
    } finally {
      requestAnimationFrame(draw);
    }
  }
  requestAnimationFrame(draw);
})();
