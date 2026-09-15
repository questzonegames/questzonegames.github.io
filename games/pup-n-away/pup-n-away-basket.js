// ===== Pup N Away — basket controller =====
//
// Owns the basket's position/velocity, reads the shared input state,
// and never lets the basket leave the gameplay boundaries. Draws the
// real supplied basket art (assets/img/pup-n-away/baskets/default-
// basket.png, the cloud/star basket) at its own aspect ratio via
// PNA_CONFIG.ASSETS.baskets.default — draw() below only falls back to
// a plain, honestly-placeholder canvas shape if that image ever fails
// to load.
(function () {
  const CFG = window.PNA_CONFIG;
  const P = CFG.PHYSICS;

  const reduceMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function motionScale() { return reduceMotionQuery && reduceMotionQuery.matches ? 0.3 : 1; }

  function createBasket(images) {
    const state = {
      x: CFG.DESIGN_W / 2,       // center X
      y: CFG.DESIGN_H - 90,      // top-surface Y (the bounce plane)
      vx: 0,
      width: P.basketWidth,
      height: P.basketHeight,
      squashTimer: 0
    };
    const img = images['baskets.default'] || null;

    function update(dt, input) {
      const left = input.left || (input.pointerActive && input.pointerDesignX < state.x - 6);
      const right = input.right || (input.pointerActive && input.pointerDesignX > state.x + 6);

      if (input.pointerActive && !input.left && !input.right) {
        // pointer/touch: smoothly follow the target X instead of a
        // binary left/right accelerate — feels natural for drag/mouse
        const target = Math.max(state.width / 2, Math.min(CFG.DESIGN_W - state.width / 2, input.pointerDesignX));
        state.x += (target - state.x) * Math.min(1, P.pointerFollowLerp * (dt * 60));
        state.vx = (target - state.x);
      } else {
        if (input.left && !input.right) {
          state.vx -= P.basketAcceleration * dt;
        } else if (input.right && !input.left) {
          state.vx += P.basketAcceleration * dt;
        } else {
          // decelerate toward zero
          const decel = P.basketDeceleration * dt;
          if (state.vx > 0) state.vx = Math.max(0, state.vx - decel);
          else if (state.vx < 0) state.vx = Math.min(0, state.vx + decel);
        }
        state.vx = Math.max(-P.basketSpeed, Math.min(P.basketSpeed, state.vx));
        state.x += state.vx * dt;
      }

      const half = state.width / 2;
      if (state.x < half) { state.x = half; state.vx = 0; }
      if (state.x > CFG.DESIGN_W - half) { state.x = CFG.DESIGN_W - half; state.vx = 0; }

      if (state.squashTimer > 0) state.squashTimer = Math.max(0, state.squashTimer - dt * 1000);
    }

    function squash() { state.squashTimer = P.basketSquashMs; }

    function draw(ctx) {
      const half = state.width / 2;
      const squashT = (state.squashTimer / P.basketSquashMs) * motionScale(); // 1 -> 0
      const sx = 1 + squashT * 0.14;
      const sy = 1 - squashT * 0.16;

      ctx.save();
      ctx.translate(state.x, state.y + state.height / 2);
      ctx.scale(sx, sy);

      if (img) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -half, -state.height / 2, state.width, state.height);
      } else {
        // Honest placeholder — clearly primitive shapes, not an attempt
        // at finished art. See the header comment: no basket asset was
        // supplied, this stands in until one is.
        const w = state.width, h = state.height;
        ctx.fillStyle = '#7a4a2b';
        ctx.strokeStyle = '#4a2c18';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h / 2);
        ctx.lineTo(w / 2, -h / 2);
        ctx.lineTo(w / 2 - 14, h / 2);
        ctx.lineTo(-w / 2 + 14, h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 3;
        for (let i = 1; i < 4; i++) {
          const lx = -w / 2 + (w * i) / 4;
          ctx.beginPath(); ctx.moveTo(lx, -h / 2 + 4); ctx.lineTo(lx * 0.85, h / 2 - 4); ctx.stroke();
        }
      }
      ctx.restore();
    }

    return { state, update, squash, draw };
  }

  window.PNA_Basket = { createBasket };
})();
