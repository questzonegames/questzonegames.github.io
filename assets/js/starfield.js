// ===== Quest Zone — homepage-only starfield background =====
// Three canvases share this one engine:
//   #site-starfield   — full-page, subtle, sits behind everything (z:-1)
//   #star-rail-left/right — pinned exactly to the outer margins, at a very
//                           high z-index so they can never end up hidden
//                           behind anything. They never overlap game
//                           panels, since they only occupy the true
//                           margin outside the boxed content.
// All three: twinkling white/blue stars, brighter near the cursor.
(function () {
  function attach(canvas, opts) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let stars = [];
    let mouseX = -9999, mouseY = -9999;
    const hoverRadius = opts.hoverRadius;

    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouseX = e.clientX - r.left;
      mouseY = e.clientY - r.top;
    });
    window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

    function resize() {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width) || 1);
      canvas.height = Math.max(1, Math.round(r.height) || 1);
      const count = Math.max(opts.minCount, Math.floor((canvas.width * canvas.height) / opts.density));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * opts.rSpread + opts.rMin,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.015 + 0.006,
        blue: Math.random() < 0.4
      }));
    }
    window.addEventListener('resize', resize);
    resize();

    function draw(t) {
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (opts.paintBlack) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        for (const s of stars) {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed * 50 + s.phase);
          const dist = Math.hypot(mouseX - s.x, mouseY - s.y);
          const hoverBoost = Math.max(0, 1 - dist / hoverRadius);

          const alpha = opts.baseAlpha + twinkle * opts.twinkleAmp + hoverBoost * 0.2;
          const radius = s.r * (1 + hoverBoost * 1.4);

          ctx.fillStyle = s.blue ? '#a8d0ff' : '#ffffff';
          ctx.globalAlpha = Math.min(1, (opts.haloAlpha + hoverBoost * 0.5) * (s.blue ? 1 : 0.85));
          ctx.beginPath();
          ctx.arc(s.x, s.y, radius * (opts.haloMult + hoverBoost * 1.8), 0, Math.PI * 2);
          ctx.fill();

          ctx.globalAlpha = Math.min(1, alpha);
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
  }

  // full-page ambient layer — subtle, sits behind everything
  attach(document.getElementById('site-starfield'), {
    density: 2200, minCount: 40, rMin: 0.9, rSpread: 1.6,
    baseAlpha: 0.5, twinkleAmp: 0.25, haloAlpha: 0.18, haloMult: 2.4,
    hoverRadius: 170, paintBlack: true
  });

  // outer-margin rails — bold and unmissable, transparent background so
  // only the stars themselves show (the page background behind stays
  // pure black from the body/html style)
  const railOpts = {
    density: 2600, minCount: 12, rMin: 1.6, rSpread: 2.2,
    baseAlpha: 0.85, twinkleAmp: 0.15, haloAlpha: 0.35, haloMult: 3,
    hoverRadius: 150, paintBlack: false
  };
  attach(document.getElementById('star-rail-left'), railOpts);
  attach(document.getElementById('star-rail-right'), railOpts);
})();
