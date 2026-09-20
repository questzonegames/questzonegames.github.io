// ===== Pup N Away — dog controller =====
//
// Owns the dog's physics state (position/velocity/flight-vs-ground) and
// its animation state machine. Every frame is drawn through one shared
// anchor-correction path (see spriteDrawRect below) so switching poses
// never makes the dog visually jump, regardless of how much transparent
// padding any individual supplied PNG has.
(function () {
  const CFG = window.PNA_CONFIG;
  const P = CFG.PHYSICS;
  const ANCHORS = CFG.SPRITE_ANCHORS;

  // ---------------------------------------------------------------
  // Central manifest mapping animation STATES to the actual discovered
  // asset keys — see the implementation report for the full reasoning.
  // Nothing downstream ever references a filename directly.
  // ---------------------------------------------------------------
  const BOUNCE_POSE = {
    // Every in-flight moment (rising, falling, or arcing sideways off
    // an angled bounce) uses the one real supplied "dog bounce" frame
    // (a tucked/curled pose) — it has no inherent up/down/left/right
    // bias on its own, so the sense of direction instead comes from
    // spinning it (see tuckRotation below), like a ball rolling through
    // the air in the direction it's travelling.
    curled: { key: 'dogCurled', anchor: ANCHORS.dogCurled, mode: 'center' },
    // basket impact / wall rebound -> the run-cycle's own "compression"
    // frame (a genuinely crouched/compressed pose) for that facing —
    // kept as a brief, non-rotated reaction flash, distinct from the
    // rolling ball state above.
    impactRight: { key: 'dogRun.right.1', anchor: ANCHORS.dogRunRight[1], mode: 'center' },
    impactLeft: { key: 'dogRun.left.1', anchor: ANCHORS.dogRunLeft[1], mode: 'center' }
  };

  function createDog(images, level) {
    const state = {
      x: level.dogStart.x,
      y: level.dogStart.y,
      vx: level.dogStart.vx,
      vy: level.dogStart.vy,
      radius: P.dogCollisionRadius,
      justBounced: false,
      grounded: true,          // true during intro/outro run sequences, false while airborne
      facing: 'right',
      runFrame: 0,
      runElapsedMs: 0,
      impactFlashMs: 0,
      lastRelativeHit: 0,
      bounceCharge: 0,   // 0-1 "how built-up is the next bounce" — see pup-n-away-physics.js
      tuckRotation: 0    // radians — spins the curled/ball pose to show travel direction
    };

    function setGroundPosition(x, y, facing) {
      state.grounded = true;
      state.x = x; state.y = y; state.vx = 0; state.vy = 0; state.facing = facing || state.facing;
    }
    function launch(vx, vy) {
      state.grounded = false;
      state.vx = vx; state.vy = vy;
      // A fresh launch (level start, or after a missed catch) starts
      // the height-building mechanic over from nothing.
      state.bounceCharge = 0;
      state.tuckRotation = 0;
    }

    function updateRunAnimation(dt, runSpeed) {
      state.runElapsedMs += dt * 1000;
      if (state.runElapsedMs >= P.dogFrameMs) {
        state.runElapsedMs -= P.dogFrameMs;
        state.runFrame = (state.runFrame + 1) % 5;
      }
    }

    function update(dt) {
      if (state.impactFlashMs > 0) state.impactFlashMs = Math.max(0, state.impactFlashMs - dt * 1000);
      if (state.vx > 8) state.facing = 'right';
      else if (state.vx < -8) state.facing = 'left';

      // Spin the tucked/curled pose like a ball rolling through the
      // air: angular speed follows the rolling constraint (vx/radius),
      // so it visibly spins right when moving right, left when moving
      // left, faster the faster it's travelling horizontally.
      if (!state.grounded) {
        const rollRadius = P.dogVisualSize / 2;
        state.tuckRotation += (state.vx / rollRadius) * dt;
      }
    }

    // Picks which pose to draw for the current airborne velocity.
    function currentAirbornePose() {
      if (state.impactFlashMs > 0) {
        return state.facing === 'left' ? BOUNCE_POSE.impactLeft : BOUNCE_POSE.impactRight;
      }
      return BOUNCE_POSE.curled;
    }

    function onBasketImpact() { state.impactFlashMs = 160; }
    function onWallImpact() { state.impactFlashMs = 110; }
    function onObstacleImpact() { state.impactFlashMs = 160; }

    // Draws any frame anchored consistently regardless of the source
    // PNG's own transparent padding — 'center' mode aligns the sprite's
    // measured ink-center to (worldX, worldY); 'foot' mode aligns the
    // sprite's measured ground-contact point to (worldX, worldY) so a
    // run cycle's feet never appear to slide/jump between frames.
    function spriteDrawRect(anchor, worldX, worldY, mode, visualSize) {
      const scale = visualSize / Math.max(anchor.w, anchor.h);
      const drawW = anchor.w * scale;
      const drawH = anchor.h * scale;
      let originX, originY;
      if (mode === 'foot') {
        originX = worldX - anchor.centerX * scale;
        originY = worldY - anchor.footY * scale;
      } else {
        originX = worldX - anchor.centerX * scale;
        originY = worldY - (anchor.centerY != null ? anchor.centerY : anchor.h / 2) * scale;
      }
      return { x: originX, y: originY, w: drawW, h: drawH };
    }

    function draw(ctx, images) {
      ctx.save();
      // Smoothing is set once centrally, in pup-n-away.js's
      // resizeCanvasForDPR(), whenever the canvas backing store
      // actually changes size.

      if (state.grounded) {
        const dir = state.facing;
        const frames = dir === 'left' ? ANCHORS.dogRunLeft : ANCHORS.dogRunRight;
        const keyBase = dir === 'left' ? 'dogRun.left.' : 'dogRun.right.';
        const anchor = frames[state.runFrame];
        const img = images[keyBase + state.runFrame];
        if (img) {
          const rect = spriteDrawRect(anchor, state.x, state.y, 'foot', P.dogVisualSize);
          ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
        }
      } else {
        const pose = currentAirbornePose();
        const img = images[pose.key];
        if (img) {
          if (pose === BOUNCE_POSE.curled) {
            // Rotate around the sprite's own anchor center so the spin
            // reads as the dog tumbling in place, not orbiting a point.
            const local = spriteDrawRect(pose.anchor, 0, 0, pose.mode, P.dogVisualSize);
            ctx.save();
            ctx.translate(state.x, state.y);
            ctx.rotate(state.tuckRotation);
            ctx.drawImage(img, local.x, local.y, local.w, local.h);
            ctx.restore();
          } else {
            const rect = spriteDrawRect(pose.anchor, state.x, state.y, pose.mode, P.dogVisualSize);
            ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
          }
        }
      }
      ctx.restore();

      if (window.PNA_DEV_MODE && window.PNA_DEBUG_COLLISION) {
        ctx.save();
        ctx.strokeStyle = '#ff2d78';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(state.x, state.y, state.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    return { state, setGroundPosition, launch, update, updateRunAnimation, onBasketImpact, onWallImpact, onObstacleImpact, draw, spriteDrawRect };
  }

  window.PNA_Dog = { createDog, BOUNCE_POSE };
})();
