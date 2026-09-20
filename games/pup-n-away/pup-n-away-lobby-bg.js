// ===== Pup N Away — shared menu background slideshow =====
//
// Purely decorative rotation through the 9 supplied lobby-background
// images (see PNA_CONFIG.ASSETS.lobbyBackgroundSlideshow and
// #pna-lobby-bg in index.html), shown behind ALL FOUR menu screens
// (Lobby, Level Select, Challenges, Equipment) as ONE shared instance —
// #pna-lobby-bg is a direct child of #pna-stage-wrap, a sibling of every
// .pna-overlay screen div, not nested inside any one of them, so
// switching between menu screens (which only ever toggles those
// .pna-overlay divs' .hidden class — see showScreen() in
// pup-n-away-ui.js) never touches this element at all: the slideshow
// just keeps cycling underneath whichever menu screen happens to be
// visible, with no restart and no flash. Every image is already fully
// preloaded by the main boot sequence's PNA_Assets.loadAll() before this
// module's init() ever runs, so there is never a network fetch here —
// only two persistent <img> layers whose `src` gets pointed at
// already-cached URLs and whose opacity is crossfaded via CSS.
//
// Lifecycle: init(images) runs once at boot (after loadAll() resolves),
// wiring up the two layer elements and the ordered, load-failure-filtered
// image list, and shows the first frame immediately. start()/stop() are
// called from goTo() in pup-n-away.js, gated on the same MENU_STATES set
// used for lobby music (Lobby/Level Select/Challenges/Equipment) — start()
// always clears any existing timer first, so no sequence of menu<->menu
// or menu<->gameplay transitions can ever stack up a second interval.
(function () {
  const CROSSFADE_MS = 1500;
  const DISPLAY_MS = 8000;

  const reduceMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduceMotion() { return !!(reduceMotionQuery && reduceMotionQuery.matches); }

  let layers = null;       // [imgEl, imgEl] — the two persistent DOM layers
  let activeLayer = 0;     // which of layers[] is currently the visible one
  let srcList = [];        // ordered, failure-filtered image URLs
  let currentIndex = 0;    // index into srcList currently shown
  let timer = null;        // setInterval handle — never more than one live at once
  let ready = false;

  function init(images) {
    const root = document.getElementById('pna-lobby-bg');
    if (!root) return; // markup missing — degrade to no slideshow rather than throw
    const imgEls = root.querySelectorAll('.pna-lobby-bg-layer');
    if (imgEls.length !== 2) return;
    layers = [imgEls[0], imgEls[1]];

    // Pull the 9 preloaded Image objects out by their flattened manifest
    // keys (lobbyBackgroundSlideshow.0 .. .8 — see pup-n-away-assets.js's
    // flatten()). A failed/missing one resolves to null in `images` and
    // is simply skipped here, never leaving a gap or a blank frame.
    const manifest = window.PNA_CONFIG.ASSETS.lobbyBackgroundSlideshow || [];
    srcList = manifest
      .map((path, i) => images['lobbyBackgroundSlideshow.' + i])
      .filter((img) => !!img)
      .map((img) => img.src);
    if (!srcList.length) return;

    currentIndex = 0;
    activeLayer = 0;
    // First frame appears instantly — no fade-in from the stage's own
    // black background. Transition is switched off just for this one
    // assignment (forcing a reflow in between so the browser actually
    // applies "no transition" before we hand control back to the normal
    // CSS transition for every later crossfade).
    const first = layers[0];
    first.style.transition = 'none';
    first.src = srcList[0];
    first.classList.add('pna-lobby-bg-visible');
    void first.offsetWidth;
    first.style.transition = '';
    ready = true;
  }

  function advance() {
    if (!ready || srcList.length < 2) return;
    const nextIndex = (currentIndex + 1) % srcList.length;
    const outgoing = layers[activeLayer];
    const incoming = layers[1 - activeLayer];
    incoming.src = srcList[nextIndex];
    // Both opacity changes fire in the same tick, so the CSS
    // `transition: opacity 1.5s` on each layer makes them animate
    // concurrently — the incoming frame fades in while the outgoing one
    // fades out, never dropping to the black stage background in between.
    incoming.classList.add('pna-lobby-bg-visible');
    outgoing.classList.remove('pna-lobby-bg-visible');
    activeLayer = 1 - activeLayer;
    currentIndex = nextIndex;
  }

  function start() {
    stop(); // belt-and-suspenders — guarantees exactly one interval ever runs
    if (!ready) return;
    if (reduceMotion()) return; // static first frame only, no auto-advance
    timer = setInterval(advance, DISPLAY_MS);
  }

  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  window.PNA_LobbyBackground = { init, start, stop };
})();
