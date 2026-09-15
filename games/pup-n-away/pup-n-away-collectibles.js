// ===== Pup N Away — collectible manager =====
//
// Fully data-driven: adding a new collectible type only ever means a
// new entry in PNA_CONFIG.COLLECTIBLE_TYPES (see pup-n-away-config.js)
// — this file never branches on a specific item by name.
(function () {
  const CFG = window.PNA_CONFIG;
  const P = CFG.PHYSICS;

  // prefers-reduced-motion: keep the idle float/spin/scale readable but
  // much subtler, per the brief ("reduce particles/shake/pulsing but
  // preserve essential gameplay movement") — collection still works
  // exactly the same, only the decorative idle animation shrinks.
  const reduceMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function motionScale() { return reduceMotionQuery && reduceMotionQuery.matches ? 0.25 : 1; }

  function createCollectibleField(level, onCollected) {
    // Every level's `bones` entries are Dream Bones (the brief's v1
    // scope) — each becomes one live collectible instance with its own
    // idle-animation phase so a field of them never pulses in unison.
    const items = level.bones.map((pos, i) => ({
      id: 'bone-' + i,
      type: 'dreamBone',
      x: pos.x, y: pos.y,
      collected: false,
      phase: Math.random() * Math.PI * 2
    }));

    let collectedCount = 0;
    const total = items.length;

    function update(dt, dog) {
      items.forEach((item) => {
        if (item.collected) return;
        item.phase += dt * (1000 / P.collectibleIdlePeriodMs) * Math.PI * 2;
        const typeDef = CFG.COLLECTIBLE_TYPES[item.type];
        const forgiving = typeDef.radius + dog.radius * 0.15; // slightly forgiving, per brief
        if (window.PNA_Physics.circleOverlap(dog.x, dog.y, dog.radius, item.x, item.y, forgiving)) {
          item.collected = true;
          collectedCount++;
          if (onCollected) onCollected(item, collectedCount, total);
        }
      });
    }

    function draw(ctx, images) {
      items.forEach((item) => {
        if (item.collected) return;
        const typeDef = CFG.COLLECTIBLE_TYPES[item.type];
        const img = images['collectibles.' + typeDef.asset];
        const m = motionScale();
        const floatY = Math.sin(item.phase) * P.collectibleFloatPx * m;
        const rot = (Math.sin(item.phase * 0.8) * P.collectibleSpinDeg * m * Math.PI) / 180;
        const scale = 1 + Math.sin(item.phase * 1.3) * 0.05 * m;
        const size = typeDef.radius * 2.1;

        ctx.save();
        ctx.translate(item.x, item.y + floatY);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (img) {
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
        } else {
          ctx.fillStyle = '#ffd76b';
          ctx.beginPath(); ctx.arc(0, 0, typeDef.radius, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        if (window.PNA_DEV_MODE && window.PNA_DEBUG_COLLISION) {
          ctx.save();
          ctx.strokeStyle = '#2dff8f';
          ctx.beginPath(); ctx.arc(item.x, item.y, typeDef.radius, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      });
    }

    function remainingCount() { return total - collectedCount; }
    function isComplete() { return collectedCount >= total; }
    function scoreForType(type) { return CFG.COLLECTIBLE_TYPES[type].points; }

    return { items, update, draw, collectedCount: () => collectedCount, total, remainingCount, isComplete, scoreForType };
  }

  window.PNA_Collectibles = { createCollectibleField };
})();
