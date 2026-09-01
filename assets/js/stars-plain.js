// ===== Quest Zone — plain pitch-black background with sparse twinkling
// stars only (no nebula). Used everywhere except the homepage. =====
(function () {
  const canvas = document.getElementById('site-starfield') || document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const count = Math.floor((canvas.width * canvas.height) / 3200);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.02 + 0.01
    }));
  }
  window.addEventListener('resize', resize);
  resize();

  function draw(t) {
    try {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed * 50 + s.phase);
        ctx.globalAlpha = 0.2 + tw * 0.7;
        ctx.fillStyle = '#dfe8ff';
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
