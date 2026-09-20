// ===== Pup N Away — physics & collision =====
//
// Pure functions only — no game state lives here. Everything the dog
// controller needs to integrate motion, bounce off the basket/walls,
// and detect fast-moving collisions without tunnelling.
(function () {
  const P = window.PNA_CONFIG.PHYSICS;
  const W = window.PNA_CONFIG.DESIGN_W;
  const H = window.PNA_CONFIG.DESIGN_H;

  // ---------------------------------------------------------------
  // Directional basket bounce — the brief's formula, with launch SPEED
  // now driven by a build-able "charge" (0-1) instead of a flat
  // constant:
  //   relativeHit = (dogCenterX - basketCenterX) / (basketWidth/2), clamped [-1,1]
  //   angle = relativeHit * maxAngle   (0 at centre = straight up)
  //   speed = lerp(bounceSpeedBase, bounceSpeedMax, charge)
  //   vx = sin(angle) * speed
  //   vy = -cos(angle) * speed
  // A run of centered hits ramps charge up (more height each time, up
  // to a cap that reaches almost to the top of the screen); an
  // off-center hit spends part of that built-up charge to fling the
  // dog outward toward the bones instead of straight up. `charge` is
  // the value carried in from the PREVIOUS bounce (or 0 on a fresh
  // launch); the returned `newCharge` is what this hit leaves behind
  // for the next one.
  // ---------------------------------------------------------------
  function computeBounceVelocity(dogX, basketX, basketWidth, basketVx, charge) {
    let relativeHit = (dogX - basketX) / (basketWidth / 2);
    relativeHit = Math.max(-1, Math.min(1, relativeHit));
    const absHit = Math.abs(relativeHit);

    const maxAngleRad = (P.maxBounceAngleDeg * Math.PI) / 180;
    const angle = relativeHit * maxAngleRad;

    const curCharge = charge || 0;
    const speed = P.bounceSpeedBase + (P.bounceSpeedMax - P.bounceSpeedBase) * curCharge;

    let vx = Math.sin(angle) * speed;
    let vy = -Math.cos(angle) * speed;

    // A little of the basket's own motion carries into the dog — small,
    // clamped contribution only, so it adds "aim assist" feel without
    // ever destabilising the base formula above.
    vx += basketVx * P.basketMomentumTransfer;
    vx = Math.max(-P.maxHorizontalSpeed, Math.min(P.maxHorizontalSpeed, vx));

    // Safety floor: guarantee a real upward launch even at the extreme
    // edge (already true at maxBounceAngleDeg=74° by construction, this
    // just protects the invariant if the constant is ever retuned).
    if (vy > -P.minVerticalLaunchSpeed) vy = -P.minVerticalLaunchSpeed;

    const newCharge = absHit <= P.centerHitThreshold
      ? Math.min(1, curCharge + P.chargeGainPerCenterHit)
      : curCharge * (1 - Math.min(1, absHit) * P.chargeSpendRate);

    return { vx, vy, relativeHit, angle, newCharge };
  }

  // ---------------------------------------------------------------
  // Swept, substep-safe motion + wall/basket collision for one frame.
  // Splits a large step into several smaller ones (capped at
  // maxSubstepPx of travel each) so a fast-moving dog can never pass
  // through the basket's thin top surface, a side wall, or a
  // collectible between two sampled positions.
  //
  // basket: { x, y, width, height, vx }  — x/y = TOP-CENTER of the basket
  // Returns { x, y, vx, vy, bounced, hitWall, missed }
  // ---------------------------------------------------------------
  function stepDog(dog, dt, basket, radius) {
    let { x, y, vx, vy } = dog;
    let bounced = false;
    let hitWall = false;
    let missed = false;
    let justBounced = dog.justBounced || false;

    const distance = Math.hypot(vx, vy) * dt;
    const steps = Math.max(1, Math.min(P.maxSubsteps, Math.ceil(distance / P.maxSubstepPx)));
    const subDt = dt / steps;

    for (let i = 0; i < steps && !missed; i++) {
      const prevX = x, prevY = y;
      vy += P.gravity * subDt;
      x += vx * subDt;
      y += vy * subDt;

      // ---- side walls ----
      if (x - radius < 0) {
        x = radius;
        vx = Math.abs(vx) * P.wallRestitution;
        hitWall = true;
      } else if (x + radius > W) {
        x = W - radius;
        vx = -Math.abs(vx) * P.wallRestitution;
        hitWall = true;
      }
      // ---- top wall ----
      if (y - radius < 0) {
        y = radius;
        vy = Math.abs(vy) * P.wallRestitution;
        hitWall = true;
      }

      // ---- basket (only while falling, only from above, only once
      // per contact — see justBounced) ----
      const basketTopY = basket.y;
      const basketLeft = basket.x - basket.width / 2;
      const basketRight = basket.x + basket.width / 2;
      const wasAbove = prevY + radius <= basketTopY;
      const nowAtOrBelow = y + radius >= basketTopY;
      const withinX = x + radius > basketLeft && x - radius < basketRight;

      if (!justBounced && vy > 0 && withinX && wasAbove && nowAtOrBelow) {
        // land exactly on the basket surface for a clean, readable bounce
        y = basketTopY - radius;
        const result = computeBounceVelocity(x, basket.x, basket.width, basket.vx, dog.bounceCharge);
        vx = result.vx;
        vy = result.vy;
        bounced = true;
        justBounced = true;
        dog.lastRelativeHit = result.relativeHit;
        dog.bounceCharge = result.newCharge;
      } else if (justBounced && y + radius < basketTopY - 4) {
        // clear of the basket again — safe to bounce off it next time
        justBounced = false;
      }

      // ---- missed catch: fell below the basket's own row without
      // landing on it ----
      if (y - radius > basketTopY + basket.height + 40 && !bounced) {
        missed = true;
      }
    }

    return { x, y, vx, vy, bounced, hitWall, missed, justBounced };
  }

  function circleOverlap(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy <= r * r;
  }

  // Swept circle-vs-circle: true if a point travelling in a straight
  // line from (x1,y1) to (x2,y2) ever comes within `r` of (cx,cy).
  // Used for fast-moving-obstacle collision (e.g. the Star Core Orb)
  // where a single per-frame circleOverlap() at the END position alone
  // could let a high-speed dog tunnel straight through between frames —
  // pass r = obstacleRadius + dogRadius (the dog is the moving point,
  // already collapsed into the combined radius).
  function circleSweepHit(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx, py = y1 + t * dy;
    const ddx = px - cx, ddy = py - cy;
    return ddx * ddx + ddy * ddy <= r * r;
  }

  window.PNA_Physics = { computeBounceVelocity, stepDog, circleOverlap, circleSweepHit };
})();
