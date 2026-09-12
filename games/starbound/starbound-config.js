// ===== Starbound — central tuning configuration =====
//
// EVERY gameplay number lives here, and only here. starbound.js reads
// from window.STARBOUND_CONFIG rather than hard-coding values inline, so
// tuning the game (or building later difficulty tiers / Level 2+) never
// means hunting through game-loop code — just editing this file.
//
// Units:
//   - all "px" values are DESIGN-RESOLUTION pixels (1672 x 941 — see
//     DESIGN below), not real screen pixels. The renderer scales the
//     whole canvas to fit the browser responsively (see starbound.js's
//     resizeCanvas()); every drawing/physics number in the game only
//     ever deals with this fixed design space.
//   - all "PerSec" values are per real second, independent of frame rate
//     (the game loop is delta-time based, same technique Space Snake
//     uses — see games/space-snake/index.html's gameLoop()).
//
// v3 revision notes (fixed-world-coordinate background architecture):
// background.scrollSpeedPerSec ("BACKGROUND_SCROLL_SPEED") is DERIVED
// from level1.targetDurationSeconds and background.overlapPx (see the
// bottom of this file) rather than hand-picked, so the background
// finishes its climb in EXACTLY targetDurationSeconds, matching
// altitude.metersPerSecond's ("ASCENT_SPEED") own moonAltitudeMeters
// completion time by construction — not "approximately", the two clocks
// are now mathematically guaranteed to finish together. They remain two
// separate config values (nothing stops either from being hand-edited
// afterward), it's only the DEFAULT that's now exact rather than
// hand-tuned-to-be-close.
(function () {
  const DESIGN_W = 1672;
  const DESIGN_H = 941;

  const STARBOUND_CONFIG = {
    // ---- design resolution — matches the background art exactly ----
    design: {
      width: DESIGN_W,
      height: DESIGN_H
    },

    // ---- the rocket (player) ----
    rocket: {
      width: 64,           // drawn bounding box, design px
      height: 110,
      // Fixed screen position: the rocket sits at this fraction of the
      // canvas height from the TOP once flight begins (spec: "roughly
      // one-third of the way up FROM THE BOTTOM" = two-thirds down from
      // the top).
      screenYFraction: 0.66,
      horizontalSpeedPerSec: 780,   // strafe speed, design px/sec
      // How far in from each edge the rocket's CENTER may travel — keeps
      // the whole sprite on-screen rather than letting its edge clip off.
      edgeMarginPx: 40,
      // Liftoff animation: how long (ms) the rocket takes to rise from
      // its resting pad position up to its cruising screenYFraction
      // position once START LAUNCH is pressed.
      liftoffDurationMs: 1400,
      // Screen-space Y (design px) the rocket sits at on the pad before
      // liftoff — near the bottom, above the HUD.
      padScreenY: 840
    },

    // ---- world scroll (visual "we are flying up") ----
    scroll: {
      // How fast the background/world scrolls downward, design px/sec,
      // at full cruise speed. Ramps up from 0 during liftoff. This is
      // ALSO the fuel exhaust-flame intensity reference (see
      // drawRocket()) — it is NOT used to time the background art
      // anymore (see background.scrollSpeedPerSec below for that).
      cruiseSpeedPerSec: 260
    },

    // ---- altitude / distance ("ASCENT_SPEED") ----
    altitude: {
      // Real-world "metres" gained per second of flight at cruise scroll
      // speed — this IS the ASCENT_SPEED the spec asks for. Tune this to
      // change how fast the altitude counter climbs; level1.
      // moonAltitudeMeters (below) is derived from it, not the other way
      // around, so the two never drift out of sync with each other.
      metersPerSecond: 100
    },

    // ---- fuel ----
    fuel: {
      // MAX_FUEL
      max: 100,
      // FUEL_DRAIN_RATE — continuous passive drain. A full tank empties
      // in ~24s of flight with no pickups, so pickups genuinely matter
      // for the whole run rather than being optional.
      drainPerSecond: 4.2,
      // FUEL_PICKUP_HEAL — a big, meaningful restore (half a tank) now
      // that obstacle hits cost fuel instead of ending the run outright
      // (see obstacles.damage) — collecting one is a real recovery, not
      // a top-up.
      pickupRestoreAmount: 50,
      // Base spawn interval before pickupSpawnRateMultiplier is applied
      // (see that field for why it's separated out).
      pickupSpawnIntervalMinMs: 2600,
      pickupSpawnIntervalMaxMs: 4600,
      // FUEL_PICKUP_SPAWN_RATE — multiplies the interval above (<1 = more
      // frequent). Pulled tighter again so a player who actually detours
      // for fuel can realistically survive obstacle hits (-30 each, see
      // obstacles.damage) AND passive drain across the full ~120s level
      // without it coming down to luck.
      pickupSpawnRateMultiplier: 0.75,
      // Independent fall speed (design px/sec) — deliberately NOT derived
      // from scroll.cruiseSpeedPerSec (which is much slower now that it
      // only paces the ambient background art, not gameplay elements).
      // Pickups need real arcade pacing so lining up for one is an
      // active, timed decision, not a lazy drift.
      pickupFallSpeedPerSec: 260,
      pickupWidth: 46,
      pickupHeight: 58
    },

    // ---- Level 1: Earth -> Moon ----
    level1: {
      // LEVEL_1_TARGET_DURATION — the single master pacing knob. A
      // successful, uninterrupted flight should reach the Moon at
      // roughly this many seconds. altitude.moonAltitudeMeters below is
      // DERIVED from this (targetDurationSeconds * altitude.
      // metersPerSecond) specifically so the two never need to be edited
      // in lockstep by hand — change the ascent rate or the target
      // duration and the distance-to-travel recalculates itself.
      targetDurationSeconds: 120
    },

    // ---- background: one continuous virtual vertical strip ----
    // All 10 stages (assets/img/starbound/bg-01.png..bg-10.png) get a
    // PERMANENT world-space Y coordinate, computed once below and never
    // touched again for the rest of the run. There is no per-frame
    // "which stage index are we in" lookup, no stage ever gets
    // recycled/reassigned/repositioned while it might be visible — see
    // starbound.js's buildBackgroundScenes()/drawBackground(). The
    // ONLY thing that changes every frame is a single scalar,
    // state.scrollOffset (== worldOffsetY), which every scene's fixed
    // worldY is added to: `screenY = scene.worldY + worldOffsetY`. All
    // 10 images are preloaded before the player can even press START
    // LAUNCH (see init()) and kept in memory for the whole run — with
    // only 10 images there is no need to recycle anything.
    background: {
      // BACKGROUND_SCROLL_SPEED — DERIVED below (after totalTravelPx is
      // computed) so that, combined with the default overlapPx and
      // level1.targetDurationSeconds, the background finishes its climb
      // in EXACTLY targetDurationSeconds rather than "approximately" —
      // change targetDurationSeconds or overlapPx and this recalculates
      // itself instead of silently drifting out of sync.
      scrollSpeedPerSec: 0, // placeholder, overwritten below once derived
      // BACKGROUND_BLEND_HEIGHT ("overlap", per spec) — consecutive
      // scenes' world positions overlap by exactly this many px (spacing
      // between scenes = one screen-height minus this), and each scene's
      // own top/bottom edge is feathered (smoothstep alpha, 0 at the
      // very edge -> 1 fully inside) across the SAME distance — so the
      // feather zone and the physical overlap zone always line up
      // exactly: two scenes' complementary fades (one fading out top,
      // one fading in bottom) blend across precisely the region where
      // they're both actually present, never past it. Scene 0's top and
      // the LAST scene's bottom are never feathered (nothing borders
      // them there).
      overlapPx: 300,
      // BACKGROUND_SAFETY_OVERLAP — a small extra pad added to every
      // scene's drawn height (stretches each scene by a fraction of a
      // percent — visually imperceptible). With a 300px intentional
      // overlap by design, a sub-pixel scale-transform rounding error is
      // already structurally incapable of exposing a gap on its own —
      // this is pure belt-and-suspenders defensiveness, not load-bearing
      // the way an overlap nudge was in the previous (stage-index-
      // lookup) architecture.
      safetyOverlapPx: 30,
      // Per-transition overrides — everywhere else keeps the default
      // overlapPx above untouched. Keyed by the index of the EARLIER
      // scene in the pair (this entry describes the transition BETWEEN
      // stages[i] and stages[i+1]).
      //
      // Deep space (bg-09) -> Moon approach (bg-10) still showed a
      // visible horizontal line at the default 300px overlap — confirmed
      // by sampling actual rendered pixel brightness across the zone (a
      // real, if gradual, ~40 -> ~22 brightness drop over ~250px, not a
      // single hard cut, but still perceptible given how different the
      // two starfields' base tones and star patterns are). Fixed with
      // BOTH a larger overlap AND a colour/tint bridge: tintColor
      // (matching bg-09's own dominant tone) is layered across the SAME
      // overlap zone with an alpha that rises then falls (peaking at
      // tintPeakAlpha in the middle), easing the exposure jump between
      // the two source images rather than relying on straight
      // alpha-crossfading two images of noticeably different brightness
      // — see drawTransitionTintBridges() in starbound.js.
      //
      // bg-05 (above cloud layer) -> bg-06 (darkening upper atmosphere)
      // has a different problem: BOTH images independently run dark-at-
      // their-own-top to light-at-their-own-bottom, so the plain alpha
      // crossfade blends bg-06's bright BOTTOM into bg-05's dark TOP,
      // producing a brightness spike right at the seam that then dips
      // back down once bg-06 fades out and bg-05's own (still-dark, just
      // past its top) colour takes back over — measured on real rendered
      // pixels as ~59 -> ~140 -> ~59 lum over ~350px, not a hard line but
      // a real "bright -> dark band -> bright again" wobble. colorBridge
      // pulls BOTH the spike and the dip toward one shared intermediate
      // tone (see drawColorMatchBridges() in starbound.js) so the
      // brightness swing is roughly halved instead of removed by
      // repositioning anything.
      //
      // bg-06 (stars already visible at its own top) -> bg-07 (Earth's
      // curved globe visible at its own bottom, stars above that) has a
      // content clash rather than a colour one: the plain crossfade
      // reveals bg-06's stars starting at the very top of the overlap
      // zone, which is exactly where bg-07's globe is still mostly
      // opaque — so stars appear to hang over the visible Earth surface.
      // topFadeDelayFraction holds bg-06 at alpha 0 for the first ~55%
      // of its own top-fade zone (while the globe is still prominent)
      // and only ramps its stars in over the remaining ~45%, by which
      // point bg-07's globe has almost entirely faded — see
      // buildFeatheredCanvas()'s topDelayFraction parameter.
      transitionOverrides: {
        4: { colorBridge: { preExpandPx: 46, postExpandPx: 140, rampPx: 70, color: '#2f6ab5', peakAlpha: 0.6 } },
        5: { topFadeDelayFraction: 0.55 },
        8: { overlapPx: 400, tintColor: '#050f22', tintPeakAlpha: 0.45 }
      },
      // Ordered ground -> Moon. No `start` fractions anymore — a
      // scene's position in this array IS its permanent position in the
      // world (see buildBackgroundScenes()), nothing about ordering is
      // re-derived from altitude at render time.
      stages: [
        // fallback: a flat colour used ONLY if this stage's image
        // somehow isn't loaded yet — approximates that scene's own
        // dominant tone so a rendering hiccup reads as "a slightly
        // flatter version of the right scene" rather than a jarring
        // flash of an unrelated colour. Unreachable in practice since
        // all 10 are preloaded before START LAUNCH even enables.
        { image: 'bg-01.png', fallbackColor: '#6ec1e8' }, // ground / launch area
        { image: 'bg-02.png', fallbackColor: '#5fb8f0' }, // clear low sky
        { image: 'bg-03.png', fallbackColor: '#4fa6f2' }, // higher blue sky
        { image: 'bg-04.png', fallbackColor: '#a9c9e8' }, // cloud layer
        { image: 'bg-05.png', fallbackColor: '#3d7fc9' }, // above cloud layer
        { image: 'bg-06.png', fallbackColor: '#1f4d85' }, // darkening upper atmosphere
        { image: 'bg-07.png', fallbackColor: '#122f5c' }, // upper atmosphere, stars beginning
        { image: 'bg-08.png', fallbackColor: '#0a1c3d' }, // edge of Earth / Earth visible below
        { image: 'bg-09.png', fallbackColor: '#050f22' }, // deep space
        { image: 'bg-10.png', fallbackColor: '#030816' }  // Moon approach
      ]
    },

    // ---- obstacle zones ----
    // Ordered low-altitude -> high-altitude. `start` is the same
    // fraction-of-moonAltitudeMeters convention as background stages
    // (unaffected by the duration/speed rebalance above — these are
    // dimensionless 0-1 fractions either way). Each zone lists which
    // obstacle TYPES can spawn in it (see starbound.js's OBSTACLE_
    // DRAWERS for the matching draw routine per type) — adding a new
    // hazard later is just adding a type here plus one draw function,
    // nothing else in the spawn/update loop changes.
    obstacles: {
      // A hit now costs fuel (obstacles.damage) instead of ending the
      // run outright — collisionEndsRun kept as an easy on/off switch
      // for a future harder difficulty mode, but the default gameplay
      // loop is "hit = -30 fuel, fuel pickup = +50, fuel reaching 0 ends
      // the run" per spec.
      collisionEndsRun: false,
      // OBSTACLE_DAMAGE
      collisionFuelPenalty: 30,
      collisionInvulnerabilityMs: 900,
      // OBSTACLE_SIZE_MULTIPLIER — cumulative across tuning passes (2x,
      // then another 1.5x = 3x the original base-build size). Actual
      // width/height are DERIVED from this and referenceSize so the
      // multiplier stays the one number to change for a future pass.
      // The hand-authored OBSTACLE_DRAWERS shapes were all drawn
      // assuming a `referenceSize` px bounding box — starbound.js scales
      // the canvas by (width / referenceSize) before invoking a drawer,
      // so changing sizeMultiplier resizes every hazard's actual
      // artwork, not just its hit box.
      referenceSize: 70,
      sizeMultiplier: 3,
      // OBSTACLE_SPAWN_RATE — multiplies every zone's spawnIntervalMinMs/
      // MaxMs below (<1 = more frequent). Kept as one global knob so a
      // future "make it harder/easier again" pass is a single-number
      // change instead of re-editing six zone rows.
      spawnRateMultiplier: 0.55,
      zones: [
        // speedPerSec bumped to stay readable/dodgeable at the now much
        // larger size + tighter spawn rate.
        { name: 'birds',       start: 0.00, types: ['bird'],       speedPerSec: 420, spawnIntervalMinMs: 550,  spawnIntervalMaxMs: 1000 },
        { name: 'helicopters', start: 0.14, types: ['helicopter'], speedPerSec: 440, spawnIntervalMinMs: 700,  spawnIntervalMaxMs: 1300 },
        { name: 'planes',      start: 0.30, types: ['plane'],      speedPerSec: 480, spawnIntervalMinMs: 800,  spawnIntervalMaxMs: 1450 },
        { name: 'storm',       start: 0.48, types: ['stormcloud'], speedPerSec: 420, spawnIntervalMinMs: 650,  spawnIntervalMaxMs: 1200 },
        { name: 'satellites',  start: 0.66, types: ['satellite'],  speedPerSec: 360, spawnIntervalMinMs: 900,  spawnIntervalMaxMs: 1500 },
        { name: 'space',       start: 0.80, types: ['debris', 'meteor', 'rock'], speedPerSec: 480, spawnIntervalMinMs: 500, spawnIntervalMaxMs: 950 }
      ]
    },

    // ---- collision sizes ----
    // Deliberately smaller than the drawn sprite box (rocket.width/
    // height, obstacles.width/height, fuel.pickupWidth/Height) so hits
    // feel fair — a near-miss that visually grazes a sprite's corner
    // shouldn't register, only a real overlap of each thing's core. The
    // *Factor values are multiplied against the (now-doubled)
    // obstacles.width/pickupWidth, so hit boxes scale automatically with
    // the bigger art rather than needing a separate absolute number.
    collision: {
      rocketRadius: 22,
      obstacleRadiusFactor: 0.38,  // * obstacles.width
      pickupRadiusFactor: 0.42     // * fuel.pickupWidth
    },

    // ---- HUD ----
    hud: {
      altitudeDecimalPlaces: 0
    },

    // ---- difficulty ----
    // Single global ramp — obstacle spawn intervals shrink and speeds
    // rise linearly with altitude progress, clamped to these multiplier
    // bounds, so the climb gets harder without needing per-zone tuning.
    // minSpawnIntervalMultiplier applies to BOTH spawnIntervalMinMs and
    // MaxMs together.
    difficulty: {
      maxSpeedMultiplier: 1.6,
      minSpawnIntervalMultiplier: 0.55
    }
  };

  // level1.moonAltitudeMeters is DERIVED, not hand-set — see the
  // targetDurationSeconds comment above for why.
  STARBOUND_CONFIG.level1.moonAltitudeMeters =
    STARBOUND_CONFIG.level1.targetDurationSeconds * STARBOUND_CONFIG.altitude.metersPerSecond;

  // obstacles.width/height are DERIVED from referenceSize * sizeMultiplier
  // — see obstacles.sizeMultiplier's comment for why.
  STARBOUND_CONFIG.obstacles.width =
    STARBOUND_CONFIG.obstacles.referenceSize * STARBOUND_CONFIG.obstacles.sizeMultiplier;
  STARBOUND_CONFIG.obstacles.height = STARBOUND_CONFIG.obstacles.width;

  // background.scrollSpeedPerSec is DERIVED so the background finishes
  // its climb in EXACTLY level1.targetDurationSeconds. Spacing for
  // transition i (between stages[i] and stages[i+1]) is one screen-
  // height minus THAT transition's own overlap (the default, unless
  // transitionOverrides[i] specifies a different one) — see
  // buildBackgroundScenes() in starbound.js for the actual worldY
  // assignment this mirrors — so the total distance to travel before the
  // LAST scene settles at screenY=0 is the SUM of every transition's
  // spacing, not a flat multiplication, since one transition (8) now
  // uses a larger-than-default overlap.
  (function deriveBackgroundScrollSpeed() {
    const bg = STARBOUND_CONFIG.background;
    let totalTravelPx = 0;
    for (let i = 0; i < bg.stages.length - 1; i++) {
      const overlap = (bg.transitionOverrides[i] && bg.transitionOverrides[i].overlapPx) || bg.overlapPx;
      totalTravelPx += STARBOUND_CONFIG.design.height - overlap;
    }
    bg.totalTravelPx = totalTravelPx; // exposed for starbound.js to clamp worldOffsetY against
    bg.scrollSpeedPerSec = totalTravelPx / STARBOUND_CONFIG.level1.targetDurationSeconds;
  })();

  window.STARBOUND_CONFIG = STARBOUND_CONFIG;
})();
