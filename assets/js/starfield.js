// ===== Quest Zone — homepage-only starfield background =====
// Near-black canvas (a hair of navy, not flat #000) behind everything
// (z-index -1 in CSS), so it only ever shows through the open space
// around the header/nav and never sits over any UI. Tiny, crisp,
// naturally-clustered white/icy-blue points of light — most very small,
// a few brighter — with a barely-there blue haze in a couple of spots.
// Slow asynchronous twinkle (skipped under prefers-reduced-motion) and a
// soft radial cursor-proximity glow, eased in and out.
(function () {
  const canvas = document.getElementById('site-starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE_BG = '#05060d'; // almost pure black, a hair of navy
  const HOVER_RADIUS = 130;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0, cssH = 0;
  let stars = [];
  let haze = [];
  let mouseX = -9999, mouseY = -9999;

  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function makeStars(w, h) {
    // a handful of density "seeds" so coverage clusters naturally instead
    // of looking like an evenly-sprinkled, artificial grid
    const seeds = Array.from({ length: 10 + Math.round(Math.random() * 6) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      spread: Math.min(w, h) * (0.12 + Math.random() * 0.22)
    }));

    const count = Math.floor((w * h) / 1500);
    return Array.from({ length: count }, () => {
      let x, y;
      if (Math.random() < 0.72 && seeds.length) {
        const s = seeds[(Math.random() * seeds.length) | 0];
        // sum-of-uniforms ~ approximates a gaussian falloff around the seed
        const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        const ang = Math.random() * Math.PI * 2;
        x = s.x + Math.cos(ang) * g * s.spread;
        y = s.y + Math.sin(ang) * g * s.spread;
      } else {
        x = Math.random() * w;
        y = Math.random() * h;
      }

      // size skewed hard toward tiny — rare larger/brighter standouts
      const sizeRoll = Math.pow(Math.random(), 3.4);
      const r = 0.35 + sizeRoll * 1.35;
      const bright = sizeRoll > 0.55;

      return {
        x: ((x % w) + w) % w,
        y: ((y % h) + h) % h,
        r,
        blue: Math.random() < 0.42,
        baseAlpha: bright ? 0.75 + Math.random() * 0.2 : 0.35 + Math.random() * 0.35,
        twinkleAmp: bright ? 0.14 : 0.1 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        // slow, and different per star — full cycles take many seconds
        speed: 0.15 + Math.random() * 0.35,
        glow: bright,
        curBright: 0 // eased hover brightness, lerped each frame
      };
    });
  }

  function makeHaze(w, h) {
    const colors = ['70,110,190', '90,130,210'];
    return Array.from({ length: 2 + Math.round(Math.random()) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.min(w, h) * (0.35 + Math.random() * 0.25),
      color: colors[(Math.random() * colors.length) | 0],
      alpha: 0.03 + Math.random() * 0.025
    }));
  }

  function resize() {
    cssW = Math.max(1, window.innerWidth || 1);
    cssH = Math.max(1, window.innerHeight || 1);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = makeStars(cssW, cssH);
    haze = makeHaze(cssW, cssH);
  }
  window.addEventListener('resize', resize);
  resize();

  function draw(t) {
    try {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = BASE_BG;
      ctx.fillRect(0, 0, cssW, cssH);

      // barely-there nebula haze — normal blend, kept extremely faint so
      // it never competes with the black
      for (const n of haze) {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `rgba(${n.color},${n.alpha})`);
        g.addColorStop(1, `rgba(${n.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const s of stars) {
        const twinkle = reduceMotion ? 0 : Math.sin(t * 0.00035 * s.speed + s.phase) * s.twinkleAmp;

        const dist = Math.hypot(mouseX - s.x, mouseY - s.y);
        const proximity = Math.max(0, 1 - dist / HOVER_RADIUS);
        const target = proximity * proximity; // smooth (non-linear) falloff
        s.curBright += (target - s.curBright) * 0.09; // eased in/out

        const alpha = Math.min(1, Math.max(0, s.baseAlpha + twinkle + s.curBright * 0.55));
        const r = s.r * (1 + s.curBright * 0.6);

        ctx.fillStyle = s.blue ? '#cfe4ff' : '#ffffff';

        if (s.glow) {
          // the few brighter stars get a very tight, crisp soft edge —
          // not a blurry halo
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.8);
          g.addColorStop(0, s.blue ? `rgba(207,228,255,${alpha})` : `rgba(255,255,255,${alpha})`);
          g.addColorStop(0.55, s.blue ? `rgba(207,228,255,${alpha * 0.35})` : `rgba(255,255,255,${alpha * 0.35})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 1.8, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    } catch (err) {
      // never let one bad frame kill the loop
    } finally {
      requestAnimationFrame(draw);
    }
  }
  requestAnimationFrame(draw);
})();
