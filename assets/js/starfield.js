// ===== Quest Zone — homepage-only deep-space nebula background =====
// Pitch black canvas. Two richly-detailed nebula formations sit anchored
// to the outer left/right edges (baked once per resize from layered soft
// puffs + bright embedded highlight points for a photographic look) —
// never behind the game panels, which stay true pitch black. They pulse
// gently on their own and glow a little brighter under the cursor.
// Scattered twinkling white/blue stars, plus the occasional shooting star.
// This file is included on the homepage only.
(function () {
  const canvas = document.getElementById('site-starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const PALETTE = [[70, 120, 235], [96, 140, 245], [110, 90, 220], [60, 160, 220]];

  let stars = [];
  let cores = [];
  let shootingStars = [];
  let nextShootAt = 6000 + Math.random() * 7000;
  let texture = null, texPad = 0;
  let mouseX = -9999, mouseY = -9999;

  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function paintFormation(o, cx, cy, spread, tallness) {
    // broad soft base glow
    for (let i = 0; i < 4; i++) {
      const ox = cx + (Math.random() - 0.5) * spread * 0.6;
      const oy = cy + (Math.random() - 0.5) * tallness * 0.7;
      const r = spread * (0.55 + Math.random() * 0.35);
      const col = PALETTE[(Math.random() * PALETTE.length) | 0];
      const a = 0.12 + Math.random() * 0.07;
      const g = o.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      o.fillStyle = g;
      o.beginPath(); o.arc(ox, oy, r, 0, Math.PI * 2); o.fill();
    }

    // wispy filament detail, threaded vertically along the formation
    const puffs = 90;
    for (let p = 0; p < puffs; p++) {
      const tt = Math.random();
      const px = cx + (Math.random() - 0.5) * spread * (0.4 + 0.5 * Math.sin(tt * Math.PI));
      const py = cy + (tt - 0.5) * tallness;
      const r = spread * 0.045 * (0.5 + Math.random() * 1.6);
      const col = PALETTE[(Math.random() * PALETTE.length) | 0];
      const a = 0.10 + Math.random() * 0.09;
      const g = o.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      o.fillStyle = g;
      o.beginPath(); o.arc(px, py, r, 0, Math.PI * 2); o.fill();
    }

    // bright embedded highlight points — the little "star-forming knot"
    // sparkle that reads as photographic detail
    const knots = 6;
    for (let k = 0; k < knots; k++) {
      const px = cx + (Math.random() - 0.5) * spread * 0.55;
      const py = cy + (Math.random() - 0.5) * tallness * 0.85;
      const r = spread * 0.02 * (0.6 + Math.random());
      const a = 0.28 + Math.random() * 0.18;
      const g = o.createRadialGradient(px, py, 0, px, py, r * 5);
      g.addColorStop(0, `rgba(235,242,255,${a})`);
      g.addColorStop(0.35, `rgba(150,190,255,${a * 0.5})`);
      g.addColorStop(1, `rgba(150,190,255,0)`);
      o.fillStyle = g;
      o.beginPath(); o.arc(px, py, r * 5, 0, Math.PI * 2); o.fill();
    }
  }

  function buildTexture(w, h) {
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    texPad = Math.round(Math.max(w, h) * 0.08);
    const texW = Math.max(1, w + texPad * 2), texH = Math.max(1, h + texPad * 2);
    const off = document.createElement('canvas');
    off.width = texW;
    off.height = texH;
    const o = off.getContext('2d');
    o.globalCompositeOperation = 'lighter';

    // positions are computed in on-screen coordinates, then shifted by
    // texPad to land in texture space — anchored right at the true outer
    // left/right edges of the viewport, spilling a little past them
    const spread = Math.max(w * 0.26, 260);
    paintFormation(o, texPad + w * 0.02, texPad + h * 0.45, spread, h * 1.05);
    paintFormation(o, texPad + w * 0.98, texPad + h * 0.55, spread, h * 1.05);

    return off;
  }

  function resize() {
    canvas.width = Math.max(1, window.innerWidth || 1);
    canvas.height = Math.max(1, window.innerHeight || 1);

    const count = Math.floor((canvas.width * canvas.height) / 6500);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.15 + 0.25,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.015 + 0.006,
      blue: Math.random() < 0.34
    }));

    // two interactive glow cores, one per formation, for the hover response
    cores = [
      { xf: 0.04, yf: 0.4, r: Math.max(canvas.width, canvas.height) * 0.16, color: '90,140,245', phase: Math.random() * Math.PI * 2, driftAmp: 18, driftPhase: Math.random() * Math.PI * 2 },
      { xf: 0.98, yf: 0.55, r: Math.max(canvas.width, canvas.height) * 0.16, color: '110,95,225', phase: Math.random() * Math.PI * 2, driftAmp: 18, driftPhase: Math.random() * Math.PI * 2 }
    ];

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
    // the whole frame is guarded: if anything throws mid-frame, the loop
    // still reschedules itself in `finally` — a bad frame must never
    // permanently freeze the background on plain black.
    try {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ---- nebula formations: slow drift, gentle breathing ----
    if (texture && texture.width > 0 && texture.height > 0) {
      const driftX = Math.sin(t * 0.00004) * texPad * 0.5;
      const driftY = Math.cos(t * 0.00003) * texPad * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 0.00015);
      ctx.drawImage(texture, -texPad + driftX, -texPad + driftY);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- interactive cores: subtle natural pulse, gentle hover glow ----
    ctx.globalCompositeOperation = 'lighter';
    for (const n of cores) {
      const cx = n.xf * canvas.width;
      const cy = n.yf * canvas.height + Math.sin(t * 0.0001 + n.driftPhase) * n.driftAmp;
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.0002 + n.phase);

      const dist = Math.hypot(mouseX - cx, mouseY - cy);
      const hoverBoost = Math.max(0, 1 - dist / (n.r * 1.1));

      const alpha = 0.09 + breathe * 0.06 + hoverBoost * 0.18;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, n.r);
      grad.addColorStop(0, `rgba(${n.color},${alpha})`);
      grad.addColorStop(1, `rgba(${n.color},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, n.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- stars: scattered, twinkling, faint blue accents ----
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
    } catch (err) {
      // swallow and self-heal — never let one bad frame kill the loop
    } finally {
      requestAnimationFrame(draw);
    }
  }
  requestAnimationFrame(draw);
})();
