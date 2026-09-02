// ===== Quest Zone — homepage-only deep-space background =====
// Sits behind everything (z-index -1, pointer-events:none in CSS), so it
// never touches clicks/UI. Near-black base with a hair of navy. Stars are
// distributed smoothly and evenly (no clumping) but weighted so the true
// outer margins — left/right of where the boxed content will sit — carry
// noticeably more detail than the calmer center. Three depth layers, a
// sparse blue nebula wisp or two (mostly in the outer margins), and rare
// short shooting stars, also biased to the sides. Twinkle is slow and
// asynchronous; cursor proximity brightens stars and nebulas gently.
// Respects prefers-reduced-motion.
(function () {
  const canvas = document.getElementById('site-starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE_BG = '#05060d';
  const CONTENT_WIDTH = 1200; // roughly the boxed content column
  const HOVER_RADIUS = 130;
  const NEBULA_HOVER_RADIUS = 260;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0, cssH = 0;
  let stars = [];
  let nebulae = [];
  let shootingStars = [];
  let nextShootAt = 0;
  let mouseX = -9999, mouseY = -9999;

  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  // how "outer-margin" a given x is, 0 (dead center) → 1 (far edge) —
  // smooth, no hard seam, but clearly favors the sides once past the
  // notional content column
  function outerness(x, w) {
    const dx = Math.abs(x - w / 2);
    const half = CONTENT_WIDTH / 2;
    let t;
    if (dx <= half) {
      t = (dx / half) * 0.45;
    } else {
      const rest = Math.max(1, w / 2 - half);
      t = 0.45 + Math.min(1, (dx - half) / rest) * 0.55;
    }
    return t;
  }

  function pickX(w) {
    // rejection sample against the density weight so placement stays
    // evenly random within any given band — no clumping — while overall
    // density still rises smoothly toward the edges
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * w;
      const weight = 0.32 + 0.68 * Math.pow(outerness(x, w), 1.15);
      if (Math.random() < weight) return x;
    }
    return Math.random() * w;
  }

  const WHITE = [255, 255, 255];
  const ICY = [140, 195, 255];
  const PALE = [200, 220, 245];

  // one star generator, used for the entire page top-to-bottom — header
  // included — with no special-casing, so it's genuinely one continuous
  // starfield rather than two systems stitched together. (An earlier
  // "boost" here for the header band was a workaround for a real z-index
  // bug that's now fixed at the CSS level; removed since it made the
  // header stars visibly bigger/brighter than the rest.)
  function makeOneStar(w, yPick) {
    const roll = Math.random();
    let tier;
    if (roll < 0.72) tier = 1;
    else if (roll < 0.95) tier = 2;
    else tier = 3;

    const colRoll = Math.random();
    const color = colRoll < 0.5 ? WHITE : (colRoll < 0.8 ? ICY : PALE);

    const cfg = {
      1: { rMin: 0.28, rMax: 0.55, aMin: 0.2, aMax: 0.42 },
      2: { rMin: 0.55, rMax: 0.95, aMin: 0.4, aMax: 0.65 },
      3: { rMin: 0.95, rMax: 1.5, aMin: 0.7, aMax: 0.95 }
    }[tier];

    return {
      x: pickX(w),
      y: yPick(),
      r: cfg.rMin + Math.random() * (cfg.rMax - cfg.rMin),
      baseAlpha: cfg.aMin + Math.random() * (cfg.aMax - cfg.aMin),
      color,
      tier,
      twinkleAmp: 0.02 + Math.random() * 0.16, // some barely move, some more
      phase: Math.random() * Math.PI * 2,
      speed: 0.12 + Math.random() * 0.4,
      curBright: 0
    };
  }

  function makeStars(w, h) {
    const count = Math.floor((w * h) / 1300);
    return Array.from({ length: count }, () => makeOneStar(w, () => Math.random() * h));
  }

  function makeNebulae(w, h) {
    const count = 3; // sparse but always present
    // a band near each edge, sized relative to the viewport so it always
    // lands fully on-canvas (never clamped/clipped at the very edge)
    const band = Math.max(100, Math.min(w * 0.28, 320));
    return Array.from({ length: count }, (_, i) => {
      const side = i % 2 === 0 ? -1 : 1; // alternate left/right, third random
      const edgeX = side < 0 ? Math.random() * band : w - Math.random() * band;
      const x = i < 2 ? edgeX : Math.random() * w;
      return {
        x,
        y: h * (0.1 + Math.random() * 0.8),
        r: Math.min(w, h) * (0.2 + Math.random() * 0.14),
        alpha: 0.055 + Math.random() * 0.035,
        phase: Math.random() * Math.PI * 2,
        curBright: 0
      };
    });
  }

  function resize() {
    cssW = Math.max(1, window.innerWidth || 1);
    cssH = Math.max(1, window.innerHeight || 1);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = makeStars(cssW, cssH);
    nebulae = makeNebulae(cssW, cssH);
  }
  window.addEventListener('resize', resize);
  resize();
  nextShootAt = performance.now() + 10000 + Math.random() * 10000;

  function spawnShootingStar() {
    // prefer the outer thirds; keep the streak short so it rarely crosses
    // deep into the central content column
    const leftSide = Math.random() < 0.5;
    const bandStart = leftSide ? 0 : cssW * 0.66;
    const bandEnd = leftSide ? cssW * 0.34 : cssW;
    const startX = bandStart + Math.random() * (bandEnd - bandStart);
    const startY = Math.random() * cssH * 0.7;
    const angle = (leftSide ? 1 : -1) * (Math.PI * 0.12 + Math.random() * (Math.PI * 0.1)) + Math.PI * 0.18;
    const speed = 5 + Math.random() * 2.5;
    shootingStars.push({
      x: startX, y: startY,
      vx: Math.cos(angle) * speed * (leftSide ? 1 : -1),
      vy: Math.sin(angle) * speed,
      life: 1,
      len: 46 + Math.random() * 34
    });
  }

  function draw(t) {
    try {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = BASE_BG;
      ctx.fillRect(0, 0, cssW, cssH);

      // ---- nebula wisps: sparse, faint, subtly mouse-reactive ----
      for (const n of nebulae) {
        const breathe = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.00018 + n.phase);
        const dist = Math.hypot(mouseX - n.x, mouseY - n.y);
        const proximity = Math.max(0, 1 - dist / NEBULA_HOVER_RADIUS);
        n.curBright += (proximity * proximity - n.curBright) * 0.05;

        const alpha = n.alpha * (0.7 + breathe * 0.3) + n.curBright * 0.05;
        const r = n.r * (1 + n.curBright * 0.12);
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
        g.addColorStop(0, `rgba(90,150,220,${alpha})`);
        g.addColorStop(0.5, `rgba(70,120,190,${alpha * 0.5})`);
        g.addColorStop(1, 'rgba(60,110,180,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- stars: layered depth, async twinkle, cursor glow ----
      for (const s of stars) {
        const twinkle = reduceMotion ? 0 : Math.sin(t * 0.00035 * s.speed + s.phase) * s.twinkleAmp;

        const dist = Math.hypot(mouseX - s.x, mouseY - s.y);
        const proximity = Math.max(0, 1 - dist / HOVER_RADIUS);
        const target = proximity * proximity;
        s.curBright += (target - s.curBright) * 0.09;

        const alpha = Math.min(1, Math.max(0, s.baseAlpha + twinkle + s.curBright * 0.5));
        const r = s.r * (1 + s.curBright * 0.5);
        const [cr, cg, cb] = s.color;

        if (s.tier === 3) {
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.2);
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
          g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${alpha * 0.3})`);
          g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- rare shooting stars, biased to the outer thirds ----
      if (!reduceMotion) {
        if (t >= nextShootAt) {
          spawnShootingStar();
          nextShootAt = t + 10000 + Math.random() * 10000;
        }
        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const sh = shootingStars[i];
          sh.x += sh.vx;
          sh.y += sh.vy;
          sh.life -= 0.028;
          if (sh.life <= 0) { shootingStars.splice(i, 1); continue; }

          const ang = Math.atan2(sh.vy, sh.vx);
          const tailX = sh.x - Math.cos(ang) * sh.len;
          const tailY = sh.y - Math.sin(ang) * sh.len;
          const fade = sh.life > 0.8 ? (1 - sh.life) / 0.2 : Math.min(1, sh.life / 0.3);
          const a = Math.max(0, fade) * 0.85;

          const g = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(0.5, `rgba(180,210,255,${a * 0.4})`);
          g.addColorStop(1, 'rgba(180,210,255,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(sh.x, sh.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();

          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.arc(sh.x, sh.y, 1.4, 0, Math.PI * 2);
          ctx.fill();
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
