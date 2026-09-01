// ===== Quest Zone — shared deep-space background =====
// Pitch-black canvas with: sparse twinkling stars (white / glowy blue),
// slow-breathing nebula clouds, and the occasional faint shooting star.
// Auto-attaches to a canvas with id="site-starfield" or id="starfield".
(function () {
  const canvas = document.getElementById('site-starfield') || document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let stars = [];
  let nebulae = [];
  let shootingStars = [];
  let nextShootAt = 6000 + Math.random() * 7000;

  const NEBULA_COLORS = ['80,110,235', '128,92,230', '60,150,205'];

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
      blue: Math.random() < 0.32
    }));

    nebulae = Array.from({ length: 3 }, (_, i) => ({
      xf: 0.15 + Math.random() * 0.7,
      yf: 0.12 + Math.random() * 0.7,
      r: Math.max(canvas.width, canvas.height) * (0.32 + Math.random() * 0.22),
      color: NEBULA_COLORS[i % NEBULA_COLORS.length],
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.5,
      driftAmp: 26 + Math.random() * 34,
      driftPhase: Math.random() * Math.PI * 2
    }));
  }
  window.addEventListener('resize', resize);
  resize();

  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.5;
    const startX = fromLeft ? -40 : canvas.width + 40;
    const startY = Math.random() * canvas.height * 0.55;
    const dropAngle = Math.PI / 7 + Math.random() * (Math.PI / 12); // shallow downward angle
    const speed = 6 + Math.random() * 3;
    shootingStars.push({
      x: startX,
      y: startY,
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

    // ---- nebula clouds: soft, slow-breathing color washes with a
    //      gently glowing core, like a distant star-forming region ----
    ctx.globalCompositeOperation = 'lighter';
    for (const n of nebulae) {
      const cx = n.xf * canvas.width + Math.sin(t * 0.00012 * n.speed + n.driftPhase) * n.driftAmp;
      const cy = n.yf * canvas.height + Math.cos(t * 0.00009 * n.speed + n.driftPhase) * n.driftAmp * 0.6;
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.00018 + n.phase);
      const alpha = 0.09 + breathe * 0.07;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, n.r);
      grad.addColorStop(0, `rgba(${n.color}, ${alpha})`);
      grad.addColorStop(0.35, `rgba(${n.color}, ${alpha * 0.55})`);
      grad.addColorStop(1, `rgba(${n.color}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, n.r, 0, Math.PI * 2);
      ctx.fill();

      // soft glowing core
      const coreR = n.r * 0.09;
      const coreAlpha = 0.22 + breathe * 0.14;
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, `rgba(225,235,255,${coreAlpha})`);
      coreGrad.addColorStop(0.5, `rgba(${n.color}, ${coreAlpha * 0.6})`);
      coreGrad.addColorStop(1, `rgba(${n.color}, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- stars: sparse, twinkling, faint blue accents ----
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
