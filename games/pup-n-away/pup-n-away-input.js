// ===== Pup N Away — input manager =====
//
// One consistent surface for keyboard, mouse and touch. Pointer Events
// are used for mouse/touch so both go through the same code path (per
// the brief). Coordinates are converted from raw browser/client pixels
// into the game's own 1920x1080 design space via the canvas's current
// on-screen rect — nothing downstream ever sees a raw browser pixel.
(function () {
  function createInputManager(canvas, designW, designH) {
    const state = {
      left: false,
      right: false,
      pointerActive: false,
      pointerDesignX: designW / 2,
      pausePressed: false,
      mutePressed: false
    };

    const keysLeft = new Set(['ArrowLeft', 'KeyA']);
    const keysRight = new Set(['ArrowRight', 'KeyD']);

    function onKeyDown(e) {
      if (keysLeft.has(e.code)) { state.left = true; e.preventDefault(); }
      else if (keysRight.has(e.code)) { state.right = true; e.preventDefault(); }
      else if (e.code === 'KeyP' || e.code === 'Escape') { state.pausePressed = true; }
      else if (e.code === 'KeyM') { state.mutePressed = true; }
    }
    function onKeyUp(e) {
      if (keysLeft.has(e.code)) { state.left = false; e.preventDefault(); }
      else if (keysRight.has(e.code)) { state.right = false; e.preventDefault(); }
    }

    // Converts a client-space (viewport pixel) coordinate into design
    // space, accounting for the canvas's current CSS size/position —
    // this is what makes input correct regardless of letterboxing,
    // window size or device pixel ratio (the canvas backing store is
    // sized in real device pixels elsewhere; this only needs the CSS
    // box, since clientX/clientY are already CSS pixels).
    function toDesignX(clientX) {
      const rect = canvas.getBoundingClientRect();
      const t = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(designW, t * designW));
    }

    function onPointerMove(e) {
      if (!state.pointerActive && e.pointerType === 'mouse' && e.buttons === 0) {
        // free mouse movement (no drag needed) still steers the basket —
        // matches "mouse movement OR dragging" from the brief
      }
      state.pointerDesignX = toDesignX(e.clientX);
      state.pointerActive = true;
    }
    function onPointerDown(e) {
      state.pointerDesignX = toDesignX(e.clientX);
      state.pointerActive = true;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    }
    function onPointerLeave() {
      // mouse leaving the canvas: keep the last known target rather than
      // snapping the basket back to center
    }

    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
    // Prevent the page itself from scrolling while dragging on the
    // canvas on touch devices.
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function consumePausePressed() {
      const v = state.pausePressed; state.pausePressed = false; return v;
    }
    function consumeMutePressed() {
      const v = state.mutePressed; state.mutePressed = false; return v;
    }

    function destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    }

    return { state, consumePausePressed, consumeMutePressed, destroy };
  }

  window.PNA_Input = { createInputManager };
})();
