// ===== Quest Zone — shared deep-space background =====
// Pitch-black canvas with: a full-coverage wispy nebula texture (baked once
// per resize from hundreds of soft overlapping puffs, so it reads as real
// nebulosity rather than a few flat circles), 2-3 brighter interactive
// cores that glow/pulse and brighten further under the cursor, dense
// twinkling white/blue stars, and the occasional faint shooting star.
// Auto-attaches to a canvas with id="site-starfield" or id="starfield".
(function () {
  const canvas = document.getElementById('site-starfield') || document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const PALETTE = [[70, 110, 230], [122, 90, 220], [58, 150, 212], [150, 92, 200]];

  let stars = [];
  let cores = [];
  let shootingStars = [];
  let nextShootAt = 6000 + Math.random() * 7000;
  let texture = null, texW = 0, texH = 0, texPad = 0;
  let mouseX = -9999, mouseY = -9999;

  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function buildTexture(w, h) {
    // oversized so slow drift never reveals an edge
    texPad = Math.round(Math.max(w, h) * 0.12);
    texW = w + texPad * 2;
    texH = h + texPad * 2;
    const off = document.createElement('canvas');
    off.width = texW;
    off.height = texH;
    const o = off.getContext('2d');
    o.globalCompositeOperation = 'lighter';

    // whole-canvas base wash — so no patch of the page is ever flat,
    // pure black; it's always at least faintly "in space"
    o.fillStyle = 'rgba(16,18,32,1)';
    o.fillRect(0, 0, texW, texH);

    // broad ambient haze — several huge, soft, overlapping washes spread
    // across the full texture for rich, unmistakably-present coverage
    for (let i = 0; i < 11; i++) {
      const cx = Math.random() * texW, cy = Math.random() * texH;
      const r = (texW + texH) * 0.28 * (0.8 + Math.random() * 0.6);
      const col = PALETTE[(Math.random() * PALETTE.length) | 0];
      const a = 0.05 + Math.random() * 0.05;
      const g = o.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      o.fillStyle = g;
      o.beginPath(); o.arc(cx, cy, r, 0, Math.PI * 2); o.fill();
    }

    // wispy filaments — clustered puffs along random paths, so the cloud
    // has organic structure instead of a perfect circular silhouette
    const wisps = 5;
    for (let wI = 0; wI < wisps; wI++) {
      const sx = Math.random() * texW, sy = Math.random() * texH;
      const ex = Math.random() * texW, ey = Math.random() * texH;
      const col = PALETTE[wI % PALETTE.length];
      const dx = ey - sy, dy = -(ex - sx);
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const puffs = 65;
      for (let p = 0; p < puffs; p++) {
        const tt = Math.random();
        const bx = sx + (ex - sx) * tt, by = sy + (ey - sy) * tt;
        const spread = (texW + texH) * 0.045 * (0.35 + 0.75 * Math.sin(tt * Math.PI));
        const wobble = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 * spread;
        const px = bx + nx * wobble, py = by + ny * wobble;
        const r = (texW + texH) * 0.009 * (0.5 + Math.random() * 1.6);
        const a = 0.04 + Math.random() * 0.05;
        const g = o.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(1, `rgba(${col},0)`);
        o.fillStyle = g;
        o.beginPath(); o.arc(px, py, r, 0, Math.PI * 2); o.fill();
      }
    }
    return off;
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // a scattering of stars — present and twinkling, not overwhelming
    const count = Math.floor((canvas.width * canvas.height) / 7000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.15 + 0.25,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.015 + 0.006,
      blue: Math.random() < 0.34
    }));

    // 2-3 brighter interactive cores layered on top of the texture
    cores = Array.from({ length: 3 }, (_, i) => ({
      xf: 0.15 + Math.random() * 0.7,
      yf: 0.12 + Math.random() * 0.7,
      r: Math.max(canvas.width, canvas.height) * (0.22 + Math.random() * 0.14),
      color: PALETTE[i % PALETTE.length],
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.4,
      driftAmp: 22 + Math.random() * 28,
      driftPhase: Math.random() * Math.PI * 2
    }));

    texture = buildTexture(canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.5;
    const startX = fromLeft ? -40 : canvas.width + 40;
    const startY = Math.random() * canvas.height * 0.55;
    const dropAngle = Math.PI / 7 + Math.random() * (Math.PI / 12);
    const speed = 6 + Math.random() * 3;
    shootingStars.push({
      x: startX, y: startY,
      vx: (fromLeft ? 1 : -1) * Math.cos(dropAngle) * speed,
      vy: Math.sin(dropAngle) * speed,
      life: 1,
      len: 80 + Math.random() * 70
    });
  }

  function draw(t) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ---- baked nebula texture: slow overall drift, gentle breathing ----
    if (texture) {
      const driftX = Math.sin(t * 0.00004) * texPad * 0.6;
      const driftY = Math.cos(t * 0.00003) * texPad * 0.6;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 0.00015);
      ctx.drawImage(texture, -texPad + driftX, -texPad + driftY);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- interactive glowing cores: subtle natural pulse, brighter glow
    //      and a wider pulse when the cursor is near ----
    ctx.globalCompositeOperation = 'lighter';
    for (const n of cores) {
      const cx = n.xf * canvas.width + Math.sin(t * 0.00012 * n.speed + n.driftPhase) * n.driftAmp;
      const cy = n.yf * canvas.height + Math.cos(t * 0.00009 * n.speed + n.driftPhase) * n.driftAmp * 0.6;
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.00022 + n.phase);

      const dist = Math.hypot(mouseX - cx, mouseY - cy);
      const hoverBoost = Math.max(0, 1 - dist / (n.r * 0.85));

      const alpha = 0.08 + breathe * 0.07 + hoverBoost * 0.2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, n.r);
      grad.addColorStop(0, `rgba(${n.color},${alpha})`);
      grad.addColorStop(0.4, `rgba(${n.color},${alpha * 0.5})`);
      grad.addColorStop(1, `rgba(${n.color},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, n.r, 0, Math.PI * 2); ctx.fill();

      const coreR = n.r * (0.07 + hoverBoost * 0.05);
      const coreAlpha = 0.2 + breathe * 0.14 + hoverBoost * 0.45;
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, `rgba(230,238,255,${coreAlpha})`);
      coreGrad.addColorStop(0.5, `rgba(${n.color},${coreAlpha * 0.6})`);
      coreGrad.addColorStop(1, `rgba(${n.color},0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- stars: dense, twinkling, faint blue accents ----
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed * 50 + s.phase);
      ctx.globalAlpha = 0.06 + tw * 0.4;
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

    // ---- the occasional faint shooting star ----
    if (t >= nextShootAt) {
      spawnShootingStar();
      nextShootAt = t + 9000 + Math.random() * 14000;
    }
    if (shootingStars.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const sh = shootingStars[i];
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life -= 0.014;
        if (sh.life <= 0 || sh.x < -160 || sh.x > canvas.width + 160 || sh.y > canvas.height + 160) {
          shootingStars.splice(i, 1);
          continue;
        }
        const ang = Math.atan2(sh.vy, sh.vx);
        const tailX = sh.x - Math.cos(ang) * sh.len;
        const tailY = sh.y - Math.sin(ang) * sh.len;
        const a = Math.max(0, sh.life) * 0.55;
        const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(0.4, `rgba(170,205,255,${a * 0.45})`);
        grad.addColorStop(1, 'rgba(170,205,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
