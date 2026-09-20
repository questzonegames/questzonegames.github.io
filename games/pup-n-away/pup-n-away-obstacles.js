// ===== Pup N Away — permanent obstacles (Star Core Orb) =====
//
// The first real "obstacle" type this engine has ever had — unlike
// collectibles (pup-n-away-collectibles.js), these are never picked up
// or removed; they exist for the whole level and permanently bounce
// the dog away on contact. Modeled closely on the collectibles module
// (level-data-driven item list, per-item phase/state, a discrete
// per-frame circleOverlap check) but adds a swept check on top so a
// fast-moving dog can't tunnel through between frames, and drives the
// dog's velocity directly instead of calling back out to the caller.
(function () {
  const CFG = window.PNA_CONFIG;
  const P = CFG.PHYSICS;

  // Same idiom as pup-n-away-collectibles.js/pup-n-away-basket.js: a
  // live MediaQueryList checked each frame, scaling decorative motion
  // down rather than disabling it outright — the obstacle's silhouette
  // and position (both gameplay-relevant) never change, only how fast
  // it visibly spins.
  const reduceMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function motionScale() { return reduceMotionQuery && reduceMotionQuery.matches ? 0.25 : 1; }

  const TAU = Math.PI * 2;

  // level.obstacles: [{ id, type: 'starCoreOrb', x, y, scale, launchSpeed }]
  // — anything with an unrecognized `type` is skipped rather than
  // crashing the level, same defensive convention as pickups' unknown-
  // type handling in pup-n-away-levels.js.
  function createObstacleField(level) {
    const items = (level.obstacles || [])
      .filter((o) => o.type === 'starCoreOrb')
      .map((o, i) => ({
        id: o.id || ('star-core-orb-' + i),
        x: o.x, y: o.y,
        scale: typeof o.scale === 'number' ? o.scale : 1,
        launchSpeed: typeof o.launchSpeed === 'number' ? o.launchSpeed : P.starCoreOrbLaunchSpeed,
        starAngle: 0,
        ringAngle: 0,
        contactActive: false
      }));

    let lastDogX = null, lastDogY = null;

    function radiusOf(item) { return P.starCoreOrbCollisionRadius * item.scale; }

    // Returns the item just hit this frame, or null. Mutates `dog`
    // (the live dog.state object) directly on a hit — repositioning it
    // just outside the collider and overwriting its velocity — exactly
    // like dog.onBasketImpact()/stepDog() already do for the basket,
    // rather than routing through a callback the way collectibles do
    // (collectibles never touch dog position/velocity; this must).
    function update(dt, dog) {
      if (lastDogX === null) { lastDogX = dog.x; lastDogY = dog.y; }
      const m = motionScale();
      const starSpeedRad = TAU * P.starCoreOrbStarRotationsPerSec * m;
      const ringSpeedRad = TAU * P.starCoreOrbRingRotationsPerSec * m;
      let hit = null;

      items.forEach((item) => {
        // Counterclockwise = decreasing angle, clockwise = increasing
        // angle, in canvas space (+y down) — see draw()'s ctx.rotate().
        item.starAngle -= starSpeedRad * dt;
        item.ringAngle += ringSpeedRad * dt;

        const r = radiusOf(item);
        const combined = r + dog.radius;
        const overlapNow = window.PNA_Physics.circleOverlap(dog.x, dog.y, dog.radius, item.x, item.y, r);
        const sweptHit = window.PNA_Physics.circleSweepHit(lastDogX, lastDogY, dog.x, dog.y, item.x, item.y, combined);

        if (overlapNow || sweptHit) {
          if (!item.contactActive) {
            item.contactActive = true;
            let dx = dog.x - item.x, dy = dog.y - item.y;
            let dist = Math.hypot(dx, dy);
            if (dist < 0.001) { dx = 0; dy = -1; dist = 1; } // dog exactly on center — pick a default outward direction
            const nx = dx / dist, ny = dy / dist;
            dog.x = item.x + nx * (combined + 1);
            dog.y = item.y + ny * (combined + 1);
            dog.vx = nx * item.launchSpeed;
            dog.vy = ny * item.launchSpeed;
            dog.justBounced = false; // clear of the basket's own contact latch — a fresh launch
            hit = item;
          }
        } else {
          item.contactActive = false;
        }
      });

      lastDogX = dog.x; lastDogY = dog.y;
      return hit;
    }

    function draw(ctx, images) {
      items.forEach((item) => {
        const size = P.starCoreOrbDisplaySize * item.scale;
        const half = size / 2;
        const shellImg = images['obstacles.starCoreOrb.shell'];
        const starImg = images['obstacles.starCoreOrb.star'];
        const ringImg = images['obstacles.starCoreOrb.ring'];

        ctx.save();
        ctx.translate(item.x, item.y);
        // Layer order per the brief: shell, then star, then ring on top —
        // all three share one parent transform origin (item.x,item.y),
        // same canvas size/center/scale, only rotation differs per layer.
        if (shellImg) ctx.drawImage(shellImg, -half, -half, size, size);
        if (starImg) {
          ctx.save();
          ctx.rotate(item.starAngle);
          ctx.drawImage(starImg, -half, -half, size, size);
          ctx.restore();
        }
        if (ringImg) {
          ctx.save();
          ctx.rotate(item.ringAngle);
          ctx.drawImage(ringImg, -half, -half, size, size);
          ctx.restore();
        }
        ctx.restore();

        if (window.PNA_DEV_MODE && window.PNA_DEBUG_COLLISION) {
          ctx.save();
          ctx.strokeStyle = '#2dff8f';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(item.x, item.y, radiusOf(item), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    return { update, draw, items };
  }

  window.PNA_Obstacles = { createObstacleField };
})();
