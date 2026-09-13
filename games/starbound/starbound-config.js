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
      // Real sprite (parachute + jerry can) — square/1024x1536 source,
      // downscaled to 200x300 for the web build, so pickupWidth/Height
      // below are kept at its exact 2:3 aspect ratio to avoid stretching.
      image: 'fuel.png',
      pickupWidth: 56,
      pickupHeight: 84
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
      // Birds (sparrow/pigeon/eagle) are ONE unified altitude-scaling
      // spawner — see the `birds` config block below, trySpawnBirdObstacle()
      // in starbound.js, and the `birds.difficultyBands` comment for how
      // the mix shifts with altitude. This single zone covers what used
      // to be three separate zones (birds/pigeons/planes); planes are
      // gone entirely, replaced by eagles as the third bird tier. `types`/
      // `speedPerSec` are unused for this zone (per-type speeds live in
      // `birds` instead) — spawnIntervalMin/MaxMs still governs how often
      // a spawn is even ATTEMPTED (each attempt can still be skipped by
      // the pressure budget or a too-tight gap — see trySpawnBirdObstacle()).
      // `storm` uses real animated stormCloud sprites (see the
      // `stormCloud` config block below and spawnStormCloud()/
      // updateStormCloud()/drawStormCloud() in starbound.js) instead of
      // the generic spawnObstacle() path — `types`/`speedPerSec` are
      // unused for it, same as the `birds` zone above.
      // `satellites` (the Satellite Belt) likewise uses real sprites and
      // its own progress-scaled spawner (see the `satelliteBelt` config
      // block below and trySpawnSatellite()/updateSatellite()/
      // drawSatellite() in starbound.js) — `types`/`speedPerSec` unused.
      // `meteors` (the Meteor Wave — normal/fire/cracking meteors, real
      // sprites) is the final hazard section, running from here all the
      // way to the Moon — see the `meteorWave` config block below and
      // trySpawnMeteor()/updateMeteor()/drawMeteor() in starbound.js.
      // `types`/`speedPerSec` unused, same as the other sprite-driven
      // zones above.
      zones: [
        { name: 'birds',       start: 0.00, types: [], speedPerSec: 0, spawnIntervalMinMs: 500,  spawnIntervalMaxMs: 950 },
        { name: 'storm',       start: 0.48, types: [], speedPerSec: 0, spawnIntervalMinMs: 650,  spawnIntervalMaxMs: 1200 },
        { name: 'satellites',  start: 0.66, types: [], speedPerSec: 0, spawnIntervalMinMs: 900,  spawnIntervalMaxMs: 1500 },
        { name: 'meteors',     start: 0.80, types: [], speedPerSec: 0, spawnIntervalMinMs: 500,  spawnIntervalMaxMs: 950 }
      ],

      // ---- bird obstacles: sparrow, pigeon, eagle — real animated sprites ----
      // Every source image is square (1254x1254 as supplied, downscaled
      // to 400x400 for the web build) so drawing each at the SAME width/
      // height never stretches or distorts the art — only the per-type
      // `scale` changes how big that square is drawn.
      //
      // The three types have DELIBERATELY DIFFERENT movement identities
      // (see updateBirdObstacle() in starbound.js):
      //   - sparrow: normal wingsUp<->wingsDown flap, small constant
      //     wobble, occasionally rolls into a PERMANENT nosedive (once
      //     started it never returns to flapping — it dives at
      //     diveSpeed until it leaves the bottom of the screen).
      //   - pigeon: no real "diving" state at all — its identity IS a
      //     continuous sine-wave strafe blended with a deliberately weak
      //     pull toward the player's current X, clamped to
      //     maxHorizontalSpeed. It shows its dive SPRITE purely
      //     cosmetically whenever its own horizontal speed is near zero
      //     (looks like it's briefly dropping straight), never changing
      //     its actual fall speed or behaviour.
      //   - eagle: same flap -> PERMANENT nosedive shape as the sparrow,
      //     but tracks the player horizontally BOTH before and DURING
      //     the dive (sparrows just wobble; eagles actively correct).
      //
      // Which types can spawn is driven by `difficultyBands` below, not
      // by the zone system — birds simply stop spawning once altitude
      // passes into the `storm` (Thundercloud) zone above.
      birds: {
        sparrow: {
          images: {
            wingsUp: 'birds/sparrow-wings-up.png',
            wingsDown: 'birds/sparrow-wings-down.png',
            dive: 'birds/sparrow-dive.png'
          },
          scale: 1.0, // SPARROW_SCALE — smallest of the three
          cost: 1,    // spawn-pressure cost — see maxActiveObstaclePressure below
          fallSpeed: 260, fallSpeedVariance: 40,   // SPARROW_FALL_SPEED
          diveSpeed: 980, diveSpeedVariance: 80,   // SPARROW_DIVE_SPEED — raised again; the fastest-diving bird by a wide margin, small size is what keeps it dodgeable
          diveChance: 0.10,                        // SPARROW_DIVE_CHANCE — base chance per roll (see nosediveCheckIntervalMs); scales up with altitude within the bird section, see birdDiveProgress()
          driftSpeedMaxPxPerSec: 45,               // small constant wobble during a NORMAL (non-triggered) dive, unrelated to the pigeon's active strafing below
          // "Fly underneath a sparrow and it immediately dives at you" —
          // checked every frame while flapping (NOT a probability roll):
          // once the rocket is within this many px horizontally AND
          // below the sparrow, it dives instantly (skipping the usual
          // windup entirely — "immediately") with real tracking toward
          // the rocket, at its own separate (faster) speed. A normal
          // probabilistic dive (see diveChance above) still only ever
          // wobbles — this aggressive tracking dive is reserved for
          // actually being caught underneath one.
          underRocketTriggerHalfWidthPx: 90,
          underRocketDiveSpeed: 1200, underRocketDiveSpeedVariance: 90, // faster than the already-fast normal diveSpeed
          underRocketTrackingStrength: 1.3, // aggressive — noticeably stronger pull than even the eagle's
          underRocketMaxHorizontalSpeed: 260
        },
        pigeon: {
          images: {
            wingsUp: 'birds/pigeon-wings-up.png',
            wingsDown: 'birds/pigeon-wings-down.png',
            dive: 'birds/pigeon-dive.png'
          },
          scale: 1.3, // PIGEON_SCALE — visibly bigger than a sparrow
          cost: 2,
          fallSpeed: 210, fallSpeedVariance: 20,    // PIGEON_FALL_SPEED — moderate, slower than either dive speed
          strafeSpeed: 70,                          // PIGEON_STRAFE_SPEED — sine-wave force amplitude, NOT a top speed
          strafeFrequency: 1.6,                     // PIGEON_STRAFE_FREQUENCY — radians/sec, one full zig-zag cycle roughly every ~4s
          trackingStrength: 0.35,                   // PIGEON_TRACKING_STRENGTH — deliberately weak pull toward the player; a loose follow, not a lock-on
          maxHorizontalSpeed: 160                    // PIGEON_MAX_HORIZONTAL_SPEED — clamps strafe+tracking combined
        },
        eagle: {
          images: {
            wingsUp: 'birds/eagle-wings-up.png',
            wingsDown: 'birds/eagle-wings-down.png',
            dive: 'birds/eagle-dive.png'
          },
          scale: 1.75, // EAGLE_SCALE — largest and most threatening-looking
          cost: 4,     // combined with maxPressure below, this alone guarantees two eagles can never be active together
          fallSpeed: 195, fallSpeedVariance: 15,    // EAGLE_FALL_SPEED — slower raw drop than the smaller birds
          diveSpeed: 560, diveSpeedVariance: 40,    // EAGLE_DIVE_SPEED
          diveChance: 0.07,                         // EAGLE_DIVE_CHANCE — a bit rarer to trigger than a sparrow's, since committing is a bigger threat
          strafeSpeed: 130,                          // EAGLE_STRAFE_SPEED — used for tracking both before AND during a dive
          trackingStrength: 0.9,                    // EAGLE_TRACKING_STRENGTH — noticeably stronger pull than a pigeon's, but still clamped/gradual, never an instant lock
          maxHorizontalSpeed: 130                    // EAGLE_MAX_HORIZONTAL_SPEED
        },

        // Base drawn box (px, before a type's own `scale`) that
        // referenceSize*sizeMultiplier is designed to roughly match, so
        // birds read as a similar on-screen size to the other obstacle
        // types rather than a jarring size mismatch.
        baseSize: 190,
        // BIRD_FLAP_FRAME_TIME — how long each of wingsUp/wingsDown holds
        // before swapping to the other, while not diving.
        flapFrameTimeMs: 150,
        // A sparrow/eagle nosedive's SPRITE switches the instant it
        // starts (the visual warning), but the fast diveSpeed only
        // applies after this many ms — the bird still falls at its
        // ordinary fallSpeed for that first stretch, giving the player a
        // genuine reaction window. Unlike before, there is no matching
        // "duration" — once started, the dive is PERMANENT (sparrow and
        // eagle both) until the bird leaves the screen.
        nosediveWindupMs: 180,
        // Nosedive probability (SPARROW_DIVE_CHANCE / EAGLE_DIVE_CHANCE
        // above) is rolled periodically on this cadence, NOT every frame
        // — see updateBirdObstacle() — so the behaviour reads as an
        // occasional deliberate event rather than something retriggering
        // many times a second. Pigeons never roll this; they have no
        // dive state to enter.
        nosediveCheckIntervalMs: 450,
        // Collision hitbox: a fraction of a bird's drawn box, deliberately
        // tighter than the generic obstacleRadiusFactor below since a
        // bird sprite's wingtips take up far more of its bounding box
        // than the body — a hit should need to touch the body/head, not
        // just graze a wingtip.
        hitboxFactor: 0.24,

        // BIRD_DIFFICULTY_BY_ALTITUDE — exactly the three requested
        // phases (fraction of level1.moonAltitudeMeters, same convention
        // as `zones[].start` above): sparrows only -> + pigeons -> + rare
        // eagles, all three then continuing together until altitude
        // reaches the `storm` (Thundercloud) zone's own start (0.48
        // above), where birds stop spawning entirely — no separate
        // "phase out" logic needed, it falls out of the normal zone
        // system. `weights` (SPARROW_SPAWN_WEIGHT / PIGEON_SPAWN_WEIGHT /
        // EAGLE_SPAWN_WEIGHT) are relative, not required to sum to 1 —
        // see pickWeightedBirdType(). Each phase's own `maxPressure`
        // overrides maxActiveObstaclePressure below — phase 3's value of
        // 5 combined with the eagle's cost of 4 is what makes a second
        // simultaneous eagle mathematically impossible (4+4 > 5).
        difficultyBands: [
          { start: 0.00, weights: { sparrow: 1,    pigeon: 0,    eagle: 0    }, maxPressure: 3 }, // Phase 1 — sparrows only
          { start: 0.15, weights: { sparrow: 0.6,  pigeon: 0.4,  eagle: 0    }, maxPressure: 4 }, // Phase 2 — + pigeons
          { start: 0.32, weights: { sparrow: 0.5,  pigeon: 0.35, eagle: 0.15 }, maxPressure: 5 }  // Phase 3 — + rare eagles
        ],
        // MAX_ACTIVE_OBSTACLE_PRESSURE — fallback budget for any altitude
        // a band doesn't explicitly cover (every band above sets its
        // own, so this is mostly a safety default).
        maxActiveObstaclePressure: 4,
        // Minimum horizontal gap (px) enforced between a new bird's spawn
        // X and any obstacle still within spawnGapZoneHeightPx of the top
        // of the screen — see findBirdSpawnX(). This, not the pressure
        // budget, is what actually guarantees a dodgeable route: a spawn
        // attempt that can't find a clear enough gap is skipped outright
        // rather than forced in overlapping another bird.
        minSpawnGapPx: 230,
        spawnGapZoneHeightPx: 260
      },

      // ---- storm cloud obstacles: real animated sprites ----
      // Every source image is square (1254x1254 as supplied, downscaled
      // to 400x400) so drawing at the same width/height never stretches
      // the art — only `scale` (rolled per spawn between minScale/
      // maxScale) changes how big that square is drawn.
      //
      // Each cloud runs its own independent charge/strike state machine
      // (see updateStormCloud() in starbound.js): waiting -> charging
      // (flashing normal<->charged, speeding up as the charge nears
      // completion) -> a single lightning strike (or a quiet fizzle,
      // see strikeChance) -> waiting again. A cloud only ever has ONE
      // bolt active at a time and cannot re-charge until strikeCooldownMs
      // has passed, which is what stops the whole screen from lighting
      // up with lightning at once.
      stormCloud: {
        images: {
          normal: 'storm/cloud-normal.png',
          charged: 'storm/cloud-charged.png'
        },
        // Several bolt sprites purely for visual variety — which one is
        // used is randomised per strike (see fireLightning()).
        lightningImages: ['storm/lightning-1.png', 'storm/lightning-2.png', 'storm/lightning-3.png', 'storm/lightning-4.png'],
        baseSize: 230,
        minScale: 0.55, // STORM_CLOUD_MIN_SCALE — the small end: easier to avoid, smaller danger area, but noticeably faster (see fallSpeedForMinScale)
        maxScale: 1.85, // STORM_CLOUD_MAX_SCALE — the big end: wide, large danger area, but noticeably slower
        // STORM_CLOUD_SPAWN_RATE — multiplies the `storm` zone's own
        // spawnIntervalMinMs/MaxMs above (<1 = more frequent), on top of
        // the global obstacles.spawnRateMultiplier every zone already
        // gets — a dedicated knob for this hazard specifically. Pulled
        // well below 1 so the belt reads as genuinely busy with clouds
        // rather than a handful of stragglers.
        spawnRateMultiplier: 0.5,
        // Fall speed is DERIVED per spawn from a cloud's own rolled
        // scale (see spawnStormCloud()) — interpolated between these two
        // endpoints so bigger clouds are always slower and smaller ones
        // always faster, never independent of size.
        fallSpeedForMinScale: 205, // small cloud -> fast
        fallSpeedForMaxScale: 80,  // big cloud -> slow
        fallSpeedVariance: 18,
        // CLOUD_CHARGE_TIME — how long a charge takes from start to
        // either a strike or a fizzle. Cut roughly in half so strikes
        // come noticeably more often.
        chargeTimeMs: 800,
        // CLOUD_FLASH_RATE — the flash interval ramps from
        // flashRateMaxMs (slow, right when charging starts — the early
        // warning) down to flashRateMinMs (fast, right before the
        // strike/fizzle) as the charge progresses, so the visual urgency
        // itself telegraphs how close the cloud is to firing.
        flashRateMaxMs: 360,
        flashRateMinMs: 110,
        // CLOUD_STRIKE_COOLDOWN — minimum wait after a strike (or a
        // fizzle) before the SAME cloud can start charging again; also
        // reused (with its own random variance) as the wait before a
        // freshly-spawned cloud's very first charge, so clouds don't all
        // sync up and charge in unison. Cut roughly in half so the same
        // cloud can fire again much sooner.
        strikeCooldownMs: 1200,
        // LIGHTNING_STRIKE_CHANCE — chance a completed charge actually
        // fires a bolt rather than quietly fizzling back to waiting —
        // keeps the charge-up itself from being a 100% reliable "damage
        // is coming" signal, without making dodging feel unfair (the
        // charge/flash warning is still always genuine either way).
        strikeChance: 0.95,
        // LIGHTNING_RANGE — multiplies the cloud's own (scale-adjusted)
        // size to get the bolt's length and how far its origin point can
        // wander along the cloud's lower perimeter — a bigger cloud
        // therefore always threatens a wider area than a smaller one.
        lightningRange: 1.0,
        // LIGHTNING_DAMAGE — fuel cost of a lightning hit, through the
        // same onObstacleHit() invulnerability-window damage path every
        // other obstacle uses.
        lightningDamage: 30,
        // How long a fired bolt stays visible AND collidable before
        // disappearing.
        lightningActiveMs: 260,
        // Half-thickness (px) of the bolt's own hitbox — see
        // lightningHitTest() in starbound.js, which tests distance to
        // the bolt's actual drawn line rather than its full square
        // sprite bounds.
        lightningHitRadius: 16,
        // Cloud BODY collision — a fraction of its drawn size, same
        // "tighter than the generic obstacleRadiusFactor" idea as birds.
        hitboxFactor: 0.3,
        // Hard cap on simultaneous clouds — combined with the faster
        // spawnRateMultiplier above, this is what actually delivers "way
        // more clouds" rather than just a couple of stragglers, while
        // still bounding things so the screen can't fill up completely
        // (a spawn attempt while at the cap is skipped outright, same
        // "skip rather than force it" policy as the bird spawner's
        // pressure budget).
        maxActiveClouds: 7
      },

      // ---- Satellite Belt: real sprites + a progress-scaled difficulty curve ----
      // Every source image is square (1254x1254 as supplied, downscaled
      // to 400x400) so drawing at its own baseSize never stretches or
      // distorts the art.
      //
      // The belt has its own progress ramp (SATELLITE_BELT_PROGRESS,
      // see satelliteBeltProgress() in starbound.js) — 0 at the moment
      // altitude enters the `satellites` zone above, 1 right as it
      // reaches the `space` zone. `progressBands` (below) is stepped
      // through by that value the same "last band whose progress <= p
      // wins" way birds.difficultyBands is, moving the section from a
      // gentle single-satellite introduction to a dense, pattern-driven
      // barrage — see trySpawnSatellite()/triggerSatellitePattern() in
      // starbound.js for how patternDifficulty turns into actual
      // multi-satellite spawns (slalom/gate/fast-rain/mixed/spinner-
      // pressure), never a purely random screen-filling spawn.
      satelliteBelt: {
        types: {
          // Satellite Wide — larger, moderate speed, good for blocking
          // a lane outright (it never moves horizontally on its own).
          wide: { image: 'satellites/wide.png', baseSize: 210, fallSpeed: 165, fallSpeedVariance: 15 },
          // Satellite Thin Fast — smaller profile, much faster fall,
          // built for reactive/surprise dodging.
          thinFast: { image: 'satellites/thin-fast.png', baseSize: 150, fallSpeed: 430, fallSpeedVariance: 35 },
          // Satellite Spinner — rotates continuously while falling
          // (purely visual — spinSpeedDegPerSec — its hitbox stays a
          // plain circle so the rotation never makes it feel unfair),
          // awkward silhouette, anchors central pressure.
          spinner: { image: 'satellites/spinner.png', baseSize: 190, fallSpeed: 200, fallSpeedVariance: 20, spinSpeedDegPerSec: 150 },
          // Satellite Diagonal — steady constant horizontal drift (sign
          // randomised per spawn) on top of its fall, so the player has
          // to predict where its path actually crosses rather than just
          // its current position.
          diagonal: { image: 'satellites/diagonal.png', baseSize: 190, fallSpeed: 220, fallSpeedVariance: 20, diagonalDriftPxPerSec: 115 }
        },
        // Collision hitbox: a fraction of a satellite's drawn box —
        // same "tighter than the full sprite" idea as birds/stormCloud.
        hitboxFactor: 0.32,
        // Base spawn-attempt cadence lives on the `satellites` zone
        // entry above (an attempt can still be skipped — see
        // trySpawnSatellite()); each band's own spawnIntervalMultiplier
        // below (SATELLITE_SPAWN_RATE) scales it further, same pattern
        // storm's spawnRateMultiplier uses on top of its zone.
        // Same "skip the spawn outright rather than force an overlap"
        // gap check the bird spawner uses.
        minSpawnGapPx: 190,
        spawnGapZoneHeightPx: 240,
        // How long after a designed PATTERN fires before another one is
        // allowed — keeps patterns feeling like deliberate set-pieces
        // rather than overlapping into an unreadable mess. A band's own
        // patternCooldownMs (see the final "wave" band below) overrides
        // this where the section is meant to feel non-stop instead.
        patternCooldownMs: 2200,
        // SATELLITE_EARLY_START_FRACTION — altitude fraction (NOT belt-
        // relative progress) where satellites start attempting to spawn,
        // BEFORE the belt officially begins (see the independent timer
        // in update() — this runs alongside, not instead of, the storm
        // zone's own cloud spawner). Since this sits before the belt's
        // own start, satelliteBeltProgress() naturally clamps to 0 during
        // this window, so the very first satellites use band 0 (rarest,
        // slowest, single-at-a-time) — they genuinely ease in alongside
        // the tail of the storm cloud section rather than the belt
        // starting with a hard cut the moment clouds stop.
        earlyStartFraction: 0.60,
        // SATELLITE_BELT_PROGRESS bands — see the block comment above.
        // types: which satellites this band can spawn (plain single
        // spawns AND pattern spawns both draw from this list).
        // maxActive: SATELLITE_MAX_ACTIVE for this band (a spawn attempt
        // is skipped outright once reached, same policy as the bird
        // spawner's pressure budget / stormCloud's maxActiveClouds).
        // spawnIntervalMultiplier: SATELLITE_SPAWN_RATE (<1 = more
        // frequent attempts). speedMultiplier: SATELLITE_SPEED_MULTIPLIER
        // applied on top of each type's own fallSpeed. patternDifficulty:
        // SATELLITE_PATTERN_DIFFICULTY — 0 = never trigger a designed
        // pattern (plain single spawns only), 1 = simple patterns (gate,
        // spinner-pressure), 2 = the full pattern set (+ slalom,
        // fast-rain, mixed). patternChance: how often a spawn attempt
        // triggers a pattern instead of a single satellite.
        // WAVE_DURATION_SECONDS — how long (real seconds) the final
        // "sudden wave" band should actually last. The band's own
        // `progress` threshold below is DERIVED from this (see
        // deriveSatelliteWaveTiming() at the bottom of this file) against
        // the belt's real duration (zones.satellites.start ->
        // zones.meteors.start, scaled by level1.targetDurationSeconds),
        // so asking for "the wave lasts ~13 seconds" stays true even if
        // the belt's own altitude span or the level's overall pacing is
        // ever retuned — rather than a hand-picked progress fraction
        // silently drifting out of sync with real time. Raised from 7,
        // then 13 — "make it a very heavy, intense barrage lasting at
        // least 10 full seconds" — pushed to 15 so the safety clamp in
        // deriveSatelliteWaveTiming() still leaves comfortable margin
        // above the required 10s floor.
        waveDurationSeconds: 15,
        progressBands: [
          // EASY INTRO — one at a time, generous gaps, Wide/Diagonal
          // only, moderate speed, no patterns yet. Also what plays
          // during the early-start overlap window above.
          { progress: 0.00, types: ['wide', 'diagonal'], maxActive: 1, spawnIntervalMultiplier: 1.35, speedMultiplier: 0.85, patternDifficulty: 0, patternChance: 0 },
          // BUILD PRESSURE — introduces Thin Fast + Spinner, up to 2
          // active, simple patterns start appearing (gate / spinner
          // forcing a lane choice). Moved earlier (was 0.35) to make
          // room for the now much longer wave band below without
          // squeezing this phase out entirely.
          { progress: 0.15, types: ['wide', 'diagonal', 'thinFast', 'spinner'], maxActive: 2, spawnIntervalMultiplier: 1.0, speedMultiplier: 1.05, patternDifficulty: 1, patternChance: 0.3 },
          // SUDDEN WAVE — jumps straight from "build pressure" into the
          // full barrage (no separate intermediate step, so it reads as
          // a deliberate sudden escalation, not a gradual ramp) and
          // fills the LAST waveDurationSeconds of the belt — a
          // near-continuous stream of patterns via a much shorter
          // patternCooldownMs, very frequent spawn attempts, and the
          // highest active cap/speed. Still built entirely from the same
          // hand-designed patterns (always at least one guaranteed lane
          // each), so it stays technically dodgeable through sustained,
          // decisive movement rather than becoming random unavoidable
          // damage. `progress` here is a placeholder — see
          // deriveSatelliteWaveTiming() below, which overwrites it.
          // "currently too light... satellites must appear continuously
          // during the entire barrage... do not let the barrage end
          // early or contain long empty pauses" — maxActive raised
          // 8->12 (more can be alive on screen at once, so the
          // trySpawnSatellite() active-cap gate almost never blocks a
          // new pattern), spawnIntervalMultiplier lowered further
          // (attempts fire much more often), patternCooldownMs cut
          // roughly in half (the next pattern queues almost as soon as
          // the last one finishes launching, rather than waiting).
          { progress: 0.6, types: ['wide', 'diagonal', 'thinFast', 'spinner'], maxActive: 12, spawnIntervalMultiplier: 0.1, speedMultiplier: 1.85, patternDifficulty: 2, patternChance: 0.95, patternCooldownMs: 260 }
        ]
      },

      // ---- Meteor Wave: real sprites, 3 distinct meteor identities ----
      // Runs from here (the `meteors` zone above, start 0.80) all the
      // way to the Moon — the final hazard section, no zone after it.
      // Every source image is square (1254x1254 as supplied, downscaled
      // to 400x400) so drawing at its own baseSize never stretches or
      // distorts the art.
      //
      // NOTE: only 4 of the 5 requested fragment sprites were supplied
      // (`meteor fragment 5.png` is missing from the asset folder) — a
      // split still produces 5 independent physics fragments as
      // specced, cycling through these 4 images (fragments[4] reuses
      // fragments[0]'s art). Swap in a real 5th image here once
      // supplied; nothing else needs to change.
      //
      // Three genuinely different identities (see updateMeteor() in
      // starbound.js):
      //   - normal: picks one of 3 fixed directions at spawn (straight
      //     down / diagonal-left / diagonal-right) and gently rotates
      //     the whole way down — most common, moderate threat.
      //   - fire: a short glowing warning at the very top of the screen,
      //     then drops dead straight at high speed — no drift at all,
      //     danger is purely reaction time.
      //   - cracked: falls like a normal meteor for a random delay,
      //     then plays cracked-1 -> cracked-2 (with a scale pulse/flash/
      //     shake) and pops into 5 fragments that burst outward+upward
      //     before gravity takes over and they fall — each fragment
      //     becomes its own independent obstacle with its own hitbox.
      meteorWave: {
        images: {
          normal: 'meteors/normal.png',
          fire: 'meteors/fire.png',
          crackedStage1: 'meteors/cracked-1.png',
          crackedStage2: 'meteors/cracked-2.png',
          fragments: ['meteors/fragment-1.png', 'meteors/fragment-2.png', 'meteors/fragment-3.png', 'meteors/fragment-4.png']
        },
        baseSize: 190,
        hitboxFactor: 0.34,

        normal: {
          fallSpeed: 220, fallSpeedVariance: 30, // METEOR_NORMAL_SPEED
          rotationSpeedDegPerSec: 45, rotationSpeedVariance: 20, // METEOR_NORMAL_ROTATION_SPEED (sign randomised per spawn)
          // Horizontal component when the randomly-chosen direction is
          // diagonalLeft/diagonalRight (straight "vertical" gets none).
          diagonalSpeedPxPerSec: 95,
          cost: 1
        },
        fire: {
          fallSpeed: 1150, // METEOR_FIRE_SPEED — dead straight, no drift at all. Raised again (was 800) — "faster too"
          warningTimeMs: 300, // METEOR_FIRE_WARNING_TIME — a brief glowing tip visible at the very top of the screen before the full sprite drops in at speed
          cost: 2
        },
        cracked: {
          fallSpeed: 200, fallSpeedVariance: 20,
          // Shortened (was 900-2200 / 260) so a cracked meteor completes
          // its whole crack -> pop cycle well within the short real-time
          // window the Meteor Wave actually runs for — a slow cycle was
          // part of why splits felt like they "barely happened": many
          // simply hadn't finished cracking before the run moved on.
          crackDelayMinMs: 450, crackDelayMaxMs: 1100, // METEOR_CRACK_DELAY_MIN / METEOR_CRACK_DELAY_MAX
          crackFrameTimeMs: 170, // METEOR_CRACK_FRAME_TIME — how long cracked-1 and cracked-2 each hold before advancing
          cost: 1, // budget is never the limiting factor — "needs to be very common"
          // How many cracked meteors may be actively mid-crack-sequence
          // at once — was 1 ("do not spawn several on top of each
          // other"), raised further since the split itself only ever
          // produces fragments from ONE parent at a time; several
          // separate parents cracking around the screen doesn't create
          // the "stacked on top of each other" problem the original
          // limit was guarding against.
          maxSimultaneous: 4
        },
        fragment: {
          baseSize: 105,
          hitboxFactor: 0.42, // fragments are small — a slightly more generous fraction still keeps hits feeling fair; still the SAME generic onObstacleHit() damage path every other obstacle uses, nothing special-cased
          // METEOR_FRAGMENT_POP_SPEED / METEOR_FRAGMENT_UPWARD_FORCE —
          // both raised substantially ("shoot outward quickly and
          // forcefully... wide spread") — see spawnMeteorFragments(),
          // which also widened the actual horizontal spread factors.
          popSpeed: 460,
          upwardForce: 320,
          gravity: 560, // METEOR_FRAGMENT_GRAVITY — accelerates vy downward every frame until...
          fallSpeed: 480, // METEOR_FRAGMENT_FALL_SPEED — ...it's capped here, so fragments stay a meaningful hazard rather than drifting forever
          rotationSpeedDegPerSec: 320 // METEOR_FRAGMENT_ROTATION_SPEED (base — each fragment gets its own randomised variant)
        },

        // Same "skip the spawn outright rather than force an overlap"
        // gap check the bird/satellite spawners use.
        minSpawnGapPx: 190,
        spawnGapZoneHeightPx: 230,
        // Spawn-pressure budget (sum of every active meteor/fragment's
        // own `cost`) — a spawn attempt is skipped outright once
        // reached, same policy as the bird spawner's pressure budget.
        // A cracked meteor's cost (1) plus the 5 fragments it becomes
        // (1 each) still naturally thins out everything else around a
        // split rather than letting the screen flood right after one.
        // Raised from 9 to give the now much-more-frequent cracked
        // meteors real room to actually spawn.
        maxActiveCost: 11,

        // METEOR_*_SPAWN_WEIGHT bands, keyed by progress through the
        // WHOLE Meteor Wave section (0 entering it, 1 at the Moon) —
        // see meteorWaveProgress()/currentMeteorBand() in starbound.js.
        // Cracked is now dominant from EARLY ON (not just near the end)
        // and keeps climbing further at altitude — "very common...
        // especially at higher altitudes". spawnIntervalMultiplier drops
        // faster too, so attempts themselves come much more often.
        progressBands: [
          { progress: 0.00, weights: { normal: 0.65, fire: 0.1,  cracked: 0.25 }, spawnIntervalMultiplier: 0.9,  speedMultiplier: 0.9 },
          { progress: 0.15, weights: { normal: 0.25, fire: 0.2,  cracked: 0.55 }, spawnIntervalMultiplier: 0.65, speedMultiplier: 1.0 },
          { progress: 0.4,  weights: { normal: 0.15, fire: 0.25, cracked: 0.6  }, spawnIntervalMultiplier: 0.5,  speedMultiplier: 1.15 },
          { progress: 0.65, weights: { normal: 0.1,  fire: 0.25, cracked: 0.65 }, spawnIntervalMultiplier: 0.35, speedMultiplier: 1.3 }
        ]
      }
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

  // The Satellite Belt's final "sudden wave" band needs to last a real
  // number of seconds (waveDurationSeconds) regardless of how long the
  // belt itself is — so its progress THRESHOLD is derived here from the
  // belt's actual real-time duration (zones.satellites.start ->
  // zones.meteors.start, scaled by level1.targetDurationSeconds) rather
  // than a hand-picked fraction that would silently drift if the belt's
  // altitude span or the level's overall pacing is ever retuned.
  (function deriveSatelliteWaveTiming() {
    const zones = STARBOUND_CONFIG.obstacles.zones;
    const beltStart = zones.find((z) => z.name === 'satellites').start;
    const beltEnd = zones.find((z) => z.name === 'meteors').start;
    const beltDurationSeconds = (beltEnd - beltStart) * STARBOUND_CONFIG.level1.targetDurationSeconds;
    const bands = STARBOUND_CONFIG.obstacles.satelliteBelt.progressBands;
    const waveBand = bands[bands.length - 1]; // the final "sudden wave" band, always last
    const waveDurationSeconds = STARBOUND_CONFIG.obstacles.satelliteBelt.waveDurationSeconds;
    const rawProgress = 1 - waveDurationSeconds / beltDurationSeconds;
    // Safety floor: bands are looked up as "the LAST one in this array
    // whose own progress <= current progress", which only works correctly
    // if every band's progress is in ascending array order. A
    // waveDurationSeconds long enough to push this threshold below the
    // PREVIOUS band's own progress would silently swallow that band
    // entirely (it would never win the lookup again) — so always leave
    // it at least a sliver of a window instead.
    const previousBandProgress = bands[bands.length - 2].progress;
    waveBand.progress = Math.max(previousBandProgress + 0.02, rawProgress);
  })();

  window.STARBOUND_CONFIG = STARBOUND_CONFIG;
})();
