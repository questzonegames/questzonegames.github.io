// ===== Quest Zone — homepage-only starfield background =====
// Pitch black canvas with a generous scattering of twinkling white/blue
// stars. Each star fades in and out faintly on its own; stars near the
// cursor twinkle noticeably brighter. No nebula clouds — stars only.
// This file is included on the homepage only.
(function () {
  const canvas = document.getElementById('site-starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let stars = [];
  let mouseX = -9999, mouseY = -9999;
  const HOVER_RADIUS = 170;

  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function resize() {
    canvas.width = Math.max(1, window.innerWidth || 1);
    canvas.height = Math.max(1, window.innerHeight || 1);

    // lots of stars — a proper, unmistakably-visible scattered field
    const count = Math.floor((canvas.width * canvas.height) / 1100);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2.4 + 2,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.015 + 0.006,
      blue: Math.random() < 0.4
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
        const dist = Math.hypot(mouseX - s.x, mouseY - s.y);
        const hoverBoost = Math.max(0, 1 - dist / HOVER_RADIUS);

        // base visibility is high and steady — the twinkle animation
        // itself only nudges it gently, so stars are always unmistakably
        // there, not flickering in and out
        const alpha = 0.88 + twinkle * 0.12 + hoverBoost * 0.2;
        const radius = s.r * (1 + hoverBoost * 1.4);

        // glow halo drawn first, underneath the solid core
        ctx.fillStyle = s.blue ? '#a8d0ff' : '#ffffff';
        ctx.globalAlpha = Math.min(1, (0.35 + hoverBoost * 0.5) * (s.blue ? 1 : 0.85));
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * (3.2 + hoverBoost * 1.8), 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = s.blue ? '#b8d8ff' : '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
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
