// ===== Pup N Away — input manager =====
//
// Keyboard only, by explicit request — A/D and the arrow keys strafe
// the basket; mouse/touch pointer movement never steers it.
(function () {
  function createInputManager(canvas, designW, designH) {
    const state = {
      left: false,
      right: false,
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
