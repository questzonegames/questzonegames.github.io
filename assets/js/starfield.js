// ===== Quest Zone — site-wide deep-space background =====
// Sits behind everything (z-index -1, pointer-events:none in CSS), so it
// never touches clicks/UI. Stars are distributed smoothly and evenly (no
// clumping) but weighted so the true outer margins — left/right of where
// the boxed content will sit — carry noticeably more detail than the
// calmer center. Twinkle is slow and asynchronous; cursor proximity
// brightens stars and nebulas gently — that hover-glow mechanic is the one
// thing every redesign of this file must keep working exactly as before.
//
// On top of that established base, each page load rolls its own "scene":
// one of several curated cosmic colour themes, its own nebula placement,
// and a chance at a distant tilted galaxy disc in one back corner — so the
// background never looks quite the same twice, the way the star
// placement already didn't. A very small mouse-parallax drift on the
// nebulae/galaxy (stars stay put, see below) sells depth without ever
// competing with the foreground UI. Respects prefers-reduced-motion.
(function () {
  const canvas = document.getElementById('site-starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE_BG = '#05060d';
  const BASE_BG_RGB = [5, 6, 13];
  const CONTENT_WIDTH = 1200; // roughly the boxed content column
  const HOVER_RADIUS = 130;
  const NEBULA_HOVER_RADIUS = 260;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0, cssH = 0;
  let stars = [];
  let nebulae = [];
  let galaxy = null;
  let shootingStars = [];
  let nextShootAt = 0;
  let mouseX = -9999, mouseY = -9999;
  let parX = 0, parY = 0; // smoothed, small-amplitude parallax offset

  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  // ---- one randomized "scene" per page load ----
  // A handful of hand-picked cosmic palettes rather than random hue rolls —
  // every one has to look intentional next to the site's own blue chrome,
  // not just "different". Each carries the two nebula gradient stops, a
  // faint tint for the rarer PALE star color, and the shooting-star trail
  // tint, so a loaded theme reads consistently across every element that
  // has color at all.
  const THEMES = [
    { name: 'nebula-blue', inner: [90, 150, 220], outer: [70, 120, 190], pale: [190, 210, 255], trail: [190, 215, 255] },
    { name: 'violet-drift', inner: [150, 100, 225], outer: [120, 70, 190], pale: [215, 195, 255], trail: [210, 190, 255] },
    { name: 'emerald-aurora', inner: [70, 205, 175], outer: [50, 165, 150], pale: [190, 250, 235], trail: [190, 250, 235] },
    { name: 'ember-nova', inner: [225, 120, 90], outer: [195, 80, 130], pale: [255, 205, 190], trail: [255, 205, 190] },
    { name: 'ice-cyan', inner: [130, 205, 245], outer: [100, 165, 225], pale: [210, 240, 255], trail: [210, 240, 255] }
  ];
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const galaxyChance = 0.4; // most loads: no galaxy — it's the rare treat, not the norm

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
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * w;
      const weight = 0.32 + 0.68 * Math.pow(outerness(x, w), 1.15);
      if (Math.random() < weight) return x;
    }
    return Math.random() * w;
  }

  const WHITE = [255, 255, 255];
  const ICY = [140, 195, 255];

  function makeOneStar(w, yPick) {
    const roll = Math.random();
    let tier;
    if (roll < 0.72) tier = 1;
    else if (roll < 0.95) tier = 2;
    else tier = 3;

    const colRoll = Math.random();
    const color = colRoll < 0.5 ? WHITE : (colRoll < 0.8 ? ICY : theme.pale);

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
      twinkleAmp: 0.02 + Math.random() * 0.16,
      phase: Math.random() * Math.PI * 2,
      speed: 0.12 + Math.random() * 0.4,
      curBright: 0
    };
  }

  function makeStars(w, h) {
    const count = Math.floor((w * h) / 1300);
    return Array.from({ length: count }, () => makeOneStar(w, () => Math.random() * h));
  }

  // 2-4 nebula wisps per load (was a fixed 3) — sparse but always present,
  // now built from overlapping soft lobes instead of one perfect circle
  // each, so a wisp reads as a drifting cloud rather than a glowing orb.
  function makeNebulae(w, h) {
    const count = 2 + Math.floor(Math.random() * 3);
    const band = Math.max(100, Math.min(w * 0.28, 320));
    return Array.from({ length: count }, (_, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const edgeX = side < 0 ? Math.random() * band : w - Math.random() * band;
      const x = i < 2 ? edgeX : Math.random() * w;
      const y = h * (0.1 + Math.random() * 0.8);
      const r = Math.min(w, h) * (0.2 + Math.random() * 0.16);
      // 2-3 lobes offset from the wisp's own center — an irregular cloud
      // silhouette instead of a single concentric gradient
      const lobeCount = 2 + Math.floor(Math.random() * 2);
      const lobes = Array.from({ length: lobeCount }, () => ({
        dx: (Math.random() - 0.5) * r * 0.7,
        dy: (Math.random() - 0.5) * r * 0.7,
        rMul: 0.55 + Math.random() * 0.35
      }));
      return {
        x, y, r, lobes,
        alpha: 0.05 + Math.random() * 0.035,
        phase: Math.random() * Math.PI * 2,
        parallaxMul: 0.3 + Math.random() * 0.3,
        curBright: 0
      };
    });
  }

  // A distant galaxy disc — tilted ellipse with a bright core, a soft
  // dust-lane band, and a faint outer halo. Deliberately rare (see
  // galaxyChance) and always tucked into a back corner at low opacity: a
  // texture the eye finds on a second look, not a headline shape.
  function makeGalaxy(w, h) {
    if (Math.random() > galaxyChance) return null;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side < 0 ? w * (0.02 + Math.random() * 0.1) : w * (0.88 + Math.random() * 0.1);
    const y = h * (0.08 + Math.random() * 0.32);
    const r = Math.min(w, h) * (0.16 + Math.random() * 0.08);
    return {
      x, y, r,
      angle: (Math.random() - 0.5) * 0.6 + side * 0.35,
      squash: 0.3 + Math.random() * 0.12,
      alpha: 0.05 + Math.random() * 0.025,
      phase: Math.random() * Math.PI * 2,
      parallaxMul: 0.15,
      curBright: 0
    };
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
    galaxy = makeGalaxy(cssW, cssH);
  }
  window.addEventListener('resize', resize);
  resize();
  nextShootAt = performance.now() + 10000 + Math.random() * 10000;

  function spawnShootingStar() {
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

  function drawGalaxy(g, t) {
    const breathe = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.00012 + g.phase);
    const alpha = g.alpha * (0.75 + breathe * 0.25);
    const ox = reduceMotion ? 0 : parX * g.parallaxMul;
    const oy = reduceMotion ? 0 : parY * g.parallaxMul;

    ctx.save();
    ctx.translate(g.x + ox, g.y + oy);
    ctx.rotate(g.angle);
    ctx.scale(1, g.squash);

    // outer halo
    let grad = ctx.createRadialGradient(0, 0, 0, 0, 0, g.r);
    grad.addColorStop(0, `rgba(${theme.inner[0]},${theme.inner[1]},${theme.inner[2]},${alpha * 0.5})`);
    grad.addColorStop(0.6, `rgba(${theme.outer[0]},${theme.outer[1]},${theme.outer[2]},${alpha * 0.35})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, g.r, 0, Math.PI * 2);
    ctx.fill();

    // bright core
    grad = ctx.createRadialGradient(0, 0, 0, 0, 0, g.r * 0.28);
    grad.addColorStop(0, `rgba(255,250,240,${alpha * 1.6})`);
    grad.addColorStop(1, 'rgba(255,250,240,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, g.r * 0.28, 0, Math.PI * 2);
    ctx.fill();

    // a dust lane — a slightly darker band across the disc so it doesn't
    // read as a plain glowing blob
    ctx.globalCompositeOperation = 'multiply';
    grad = ctx.createLinearGradient(-g.r, 0, g.r, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, `rgba(${Math.round(BASE_BG_RGB[0] * 1.6)},${Math.round(BASE_BG_RGB[1] * 1.6)},${Math.round(BASE_BG_RGB[2] * 1.6)},${Math.min(1, alpha * 6)})`);
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(-g.r, -g.r * 0.14, g.r * 2, g.r * 0.28);
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
  }

  function draw(t) {
    try {
      // smoothed parallax target: mouse offset from viewport center,
      // capped small — a hint of depth, never a distraction
      if (!reduceMotion && mouseX > -9000) {
        const tx = Math.max(-1, Math.min(1, (mouseX - cssW / 2) / (cssW / 2))) * 14;
        const ty = Math.max(-1, Math.min(1, (mouseY - cssH / 2) / (cssH / 2))) * 10;
        parX += (tx - parX) * 0.03;
        parY += (ty - parY) * 0.03;
      } else {
        parX += (0 - parX) * 0.02;
        parY += (0 - parY) * 0.02;
      }

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = BASE_BG;
      ctx.fillRect(0, 0, cssW, cssH);

      // ---- distant galaxy, drawn first so everything else sits in front ----
      if (galaxy) drawGalaxy(galaxy, t);

      // ---- nebula wisps: irregular lobed clouds, subtly mouse-reactive ----
      for (const n of nebulae) {
        const breathe = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.00018 + n.phase);
        const dist = Math.hypot(mouseX - n.x, mouseY - n.y);
        const proximity = Math.max(0, 1 - dist / NEBULA_HOVER_RADIUS);
        n.curBright += (proximity * proximity - n.curBright) * 0.05;

        const alpha = n.alpha * (0.7 + breathe * 0.3) + n.curBright * 0.05;
        const ox = reduceMotion ? 0 : parX * n.parallaxMul;
        const oy = reduceMotion ? 0 : parY * n.parallaxMul;

        for (const lobe of n.lobes) {
          const r = n.r * lobe.rMul * (1 + n.curBright * 0.12);
          const lx = n.x + lobe.dx + ox;
          const ly = n.y + lobe.dy + oy;
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
          g.addColorStop(0, `rgba(${theme.inner[0]},${theme.inner[1]},${theme.inner[2]},${alpha})`);
          g.addColorStop(0.5, `rgba(${theme.outer[0]},${theme.outer[1]},${theme.outer[2]},${alpha * 0.5})`);
          g.addColorStop(1, `rgba(${theme.outer[0]},${theme.outer[1]},${theme.outer[2]},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(lx, ly, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- stars: layered depth, async twinkle, cursor glow ----
      // Deliberately NOT parallaxed — the hover-glow proximity check below
      // is computed against each star's plain logical x/y, and keeping the
      // drawn position identical to that logical position is what keeps
      // "the star under your cursor is the one that lights up" exactly
      // right at every mouse position, unchanged from before this pass.
      for (const s of stars) {
        const twinkle = reduceMotion ? 0 : Math.sin(t * 0.00035 * s.speed + s.phase) * s.twinkleAmp;

        const dist = Math.hypot(mouseX - s.x, mouseY - s.y);
        const proximity = Math.max(0, 1 - dist / HOVER_RADIUS);
        const target = proximity * proximity;
        s.curBright += (target - s.curBright) * 0.09;

        const alpha = Math.min(1, Math.max(0, s.baseAlpha + twinkle + s.curBright * 0.5));
        const r = s.r * (1 + s.curBright * 0.5);
        const [cr, cg, cb] = s.color;

        if (s.tier === 3 || s.curBright > 0.03) {
          const glowR = r * (2.2 + s.curBright * 1.6);
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
          g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${alpha * 0.3})`);
          g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- rare shooting stars, biased to the outer thirds, themed trail ----
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
          const [tr, tg, tb] = theme.trail;

          const g = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(0.5, `rgba(${tr},${tg},${tb},${a * 0.4})`);
          g.addColorStop(1, `rgba(${tr},${tg},${tb},0)`);
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
